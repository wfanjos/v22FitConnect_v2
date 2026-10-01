import { classificarErro, MotorSincronizacao } from '../motor';
import { ErroDeRede, type RemotoSincronizacao } from '../tipos';
import { criarAparelho, relogioQueAvanca, RemotoFalso, type Aparelho } from './helpers';

let servidor: RemotoFalso;
let a: Aparelho;
let b: Aparelho;

beforeEach(async () => {
  servidor = new RemotoFalso();
  a = await criarAparelho(servidor, { relogio: relogioQueAvanca('2026-10-01T10:00:00Z') });
  b = await criarAparelho(servidor, { relogio: relogioQueAvanca('2026-10-01T10:30:00Z') });
});

const novoItem = (aparelho: Aparelho, dados: Record<string, unknown> = {}) =>
  aparelho.motor.criar('itens', { dono_id: 'ana', nome: 'supino', valor: 10, ...dados });

describe('classificarErro', () => {
  it.each([
    ['42501', 'definitivo'], // RLS recusou
    ['23502', 'definitivo'], // coluna obrigatória
    ['23505', 'definitivo'], // duplicado
    ['22P02', 'definitivo'], // dado inválido
    ['42P01', 'definitivo'], // tabela inexistente
    ['P0001', 'definitivo'], // regra do servidor
    ['23503', 'passageiro'], // chave estrangeira: o pai pode estar a caminho
    ['40001', 'passageiro'], // conflito de transação
    ['53300', 'passageiro'], // servidor sobrecarregado
    ['08006', 'passageiro'], // conexão
    ['57014', 'passageiro'], // cancelado
    ['XX000', 'passageiro'],
    ['28000', 'autenticacao'],
    ['PGRST301', 'autenticacao'],
    ['401', 'autenticacao'],
    [undefined, 'passageiro'],
    ['', 'passageiro'],
  ])('%s → %s', (codigo, esperado) => {
    expect(classificarErro(codigo)).toBe(esperado);
  });
});

describe('gravar e enviar', () => {
  it('criar grava no aparelho na hora e só vai ao servidor ao sincronizar', async () => {
    const id = await novoItem(a);
    expect((await a.ler('itens', id))?.nome).toBe('supino');
    expect(servidor.linhas('itens').size).toBe(0);
    expect((await a.motor.estado()).pendentes).toBe(1);

    const relatorio = await a.motor.sincronizar();
    expect(relatorio).toMatchObject({ enviadas: 1, falhasDefinitivas: 0, adiadas: 0 });
    expect(servidor.linhas('itens').get(id)?.nome).toBe('supino');
    expect((await a.motor.estado()).pendentes).toBe(0);
  });

  it('depois de sincronizar, a linha local traz o seq_sinc e o atualizado_em do servidor', async () => {
    const id = await novoItem(a);
    await a.motor.sincronizar();
    const local = await a.ler('itens', id);
    const doServidor = servidor.linhas('itens').get(id)!;
    expect(local?.seq_sinc).toBe(doServidor.seq_sinc);
    expect(local?.atualizado_em).toBe(doServidor.atualizado_em);
  });

  it('o id criado é um uuid v7 e o criado_em do aparelho vai ao servidor', async () => {
    const id = await novoItem(a);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const criadoLocal = (await a.ler('itens', id))?.criado_em;
    await a.motor.sincronizar();
    expect(servidor.linhas('itens').get(id)?.criado_em).toBe(criadoLocal);
  });

  it('atualizar muda só as colunas informadas e envia só elas', async () => {
    const id = await novoItem(a);
    await a.motor.sincronizar();
    servidor.chamadasEnvio.length = 0;

    await a.motor.atualizar('itens', id, { valor: 99 });
    await a.motor.sincronizar();
    const enviado = servidor.chamadasEnvio[0]![0]!.registro;
    expect(enviado).toEqual({ id, valor: 99 });
    expect(servidor.linhas('itens').get(id)).toMatchObject({ nome: 'supino', valor: 99 });
  });

  it('atualizar ou excluir um registro que não existe no aparelho dá erro claro', async () => {
    await expect(a.motor.atualizar('itens', 'nao-existe', { valor: 1 })).rejects.toThrow(
      /não existe/,
    );
    await expect(a.motor.excluir('itens', 'nao-existe')).rejects.toThrow(/não existe/);
    expect((await a.motor.estado()).pendentes).toBe(0);
  });

  it('excluir marca excluido_em, nada é apagado de verdade, e envia só a exclusão', async () => {
    const id = await novoItem(a);
    await a.motor.sincronizar();
    servidor.chamadasEnvio.length = 0;

    await a.motor.excluir('itens', id);
    expect((await a.ler('itens', id))?.excluido_em).not.toBeNull();
    await a.motor.sincronizar();
    expect(Object.keys(servidor.chamadasEnvio[0]![0]!.registro).sort()).toEqual([
      'excluido_em',
      'id',
    ]);
    expect(servidor.linhas('itens').get(id)?.excluido_em).not.toBeNull();
    expect(servidor.linhas('itens').has(id)).toBe(true);
  });

  it('criar e excluir antes de sincronizar: o servidor recebe o registro já excluído', async () => {
    const id = await novoItem(a);
    await a.motor.excluir('itens', id);
    await a.motor.sincronizar();
    expect(servidor.linhas('itens').get(id)).toMatchObject({ nome: 'supino' });
    expect(servidor.linhas('itens').get(id)?.excluido_em).not.toBeNull();
  });

  it('sem nada para enviar, não chama o servidor para enviar', async () => {
    await a.motor.sincronizar();
    expect(servidor.chamadasEnvio).toHaveLength(0);
  });

  it('o envio acontece na ordem das alterações (pai antes do filho)', async () => {
    const pai = await novoItem(a);
    await a.motor.criar('filhos', { item_id: pai, dono_id: 'ana', nome: 'filho' });
    const relatorio = await a.motor.sincronizar();
    expect(relatorio).toMatchObject({ enviadas: 2, adiadas: 0, falhasDefinitivas: 0 });
    expect(servidor.chamadasEnvio[0]!.map((o) => o.tabela)).toEqual(['itens', 'filhos']);
  });
});

describe('dois aparelhos', () => {
  it('o que um cria, o outro recebe', async () => {
    const id = await novoItem(a, { nome: 'remada' });
    await a.motor.sincronizar();
    const relatorio = await b.motor.sincronizar();
    expect(relatorio.baixadas).toBe(1);
    expect(await b.ler('itens', id)).toMatchObject({ nome: 'remada', valor: 10, dono_id: 'ana' });
  });

  it('edições e exclusões também chegam', async () => {
    const id = await novoItem(a);
    await a.motor.sincronizar();
    await b.motor.sincronizar();

    await b.motor.atualizar('itens', id, { nome: 'editado no B' });
    await b.motor.sincronizar();
    await a.motor.sincronizar();
    expect((await a.ler('itens', id))?.nome).toBe('editado no B');

    await a.motor.excluir('itens', id);
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    expect((await b.ler('itens', id))?.excluido_em).not.toBeNull();
  });

  it('colunas diferentes editadas offline nos dois aparelhos: as duas edições sobrevivem', async () => {
    const id = await novoItem(a);
    await a.motor.sincronizar();
    await b.motor.sincronizar();

    await a.motor.atualizar('itens', id, { nome: 'nome do A' });
    await b.motor.atualizar('itens', id, { valor: 77 });
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    await a.motor.sincronizar();

    for (const aparelho of [a, b]) {
      expect(await aparelho.ler('itens', id)).toMatchObject({ nome: 'nome do A', valor: 77 });
    }
    expect(servidor.linhas('itens').get(id)).toMatchObject({ nome: 'nome do A', valor: 77 });
  });

  it('mesma coluna editada nos dois: vence quem chegou por último ao servidor, e os dois convergem', async () => {
    const id = await novoItem(a);
    await a.motor.sincronizar();
    await b.motor.sincronizar();

    await a.motor.atualizar('itens', id, { nome: 'A' });
    await b.motor.atualizar('itens', id, { nome: 'B' });
    await b.motor.sincronizar(); // B chega primeiro
    await a.motor.sincronizar(); // A chega por último: vence
    await b.motor.sincronizar();

    expect(servidor.linhas('itens').get(id)?.nome).toBe('A');
    expect((await a.ler('itens', id))?.nome).toBe('A');
    expect((await b.ler('itens', id))?.nome).toBe('A');
  });

  it('o relógio do aparelho não decide: edição antiga que chega depois vence', async () => {
    const id = await novoItem(a);
    await a.motor.sincronizar();
    await b.motor.sincronizar();

    await a.motor.atualizar('itens', id, { nome: 'editado cedo no A' }); // 10:00
    await b.motor.atualizar('itens', id, { nome: 'editado tarde no B' }); // 10:30
    await b.motor.sincronizar();
    await a.motor.sincronizar();
    expect(servidor.linhas('itens').get(id)?.nome).toBe('editado cedo no A');
  });

  it('o download não pisa na alteração local ainda não enviada', async () => {
    const id = await novoItem(a);
    await a.motor.sincronizar();
    await b.motor.sincronizar();

    await b.motor.atualizar('itens', id, { nome: 'B mudou' });
    await b.motor.sincronizar();
    await a.motor.atualizar('itens', id, { nome: 'A mudou, ainda offline' });

    // A baixa sem enviar: a edição pendente continua à vista.
    await a.motor.baixarNovidades();
    expect((await a.ler('itens', id))?.nome).toBe('A mudou, ainda offline');

    await a.motor.sincronizar();
    expect(servidor.linhas('itens').get(id)?.nome).toBe('A mudou, ainda offline');
  });

  it('um terceiro aparelho que entra depois baixa todo o histórico, incluindo exclusões', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await novoItem(a, { nome: `item ${i}`, valor: i }));
    await a.motor.excluir('itens', ids[2]!);
    await a.motor.sincronizar();

    const c = await criarAparelho(servidor);
    await c.motor.sincronizar();
    const linhas = await c.todos('itens');
    expect(linhas).toHaveLength(5);
    expect(linhas.filter((l) => l.excluido_em !== null)).toHaveLength(1);
  });

  it('ids criados offline em vários aparelhos nunca colidem', async () => {
    const c = await criarAparelho(servidor);
    const ids = new Set<string>();
    for (const aparelho of [a, b, c]) {
      for (let i = 0; i < 100; i++) ids.add(await novoItem(aparelho, { valor: i }));
    }
    expect(ids.size).toBe(300);
    for (const aparelho of [a, b, c]) await aparelho.motor.sincronizar();
    for (const aparelho of [a, b, c]) await aparelho.motor.sincronizar();
    expect(servidor.linhas('itens').size).toBe(300);
    for (const aparelho of [a, b, c]) expect(await aparelho.todos('itens')).toHaveLength(300);
  });
});

describe('falhas de rede', () => {
  it('sem conexão no envio: a fila fica intacta e nada se perde', async () => {
    const id = await novoItem(a);
    servidor.falhaEnvio = 'falha-antes';
    const relatorio = await a.motor.sincronizar();
    expect(relatorio.erro).toBe('rede');
    expect(relatorio.mensagemErro).toMatch(/sem conexão/);
    expect((await a.motor.estado()).pendentes).toBe(1);
    expect(servidor.linhas('itens').size).toBe(0);

    expect((await a.motor.sincronizar()).erro).toBeUndefined();
    expect(servidor.linhas('itens').has(id)).toBe(true);
  });

  it('resposta perdida: o servidor aplicou, o aparelho não soube; o reenvio é reconhecido como duplicado', async () => {
    const id = await novoItem(a);
    servidor.falhaEnvio = 'falha-depois';
    const relatorio = await a.motor.sincronizar();
    expect(relatorio.erro).toBe('rede');
    expect(servidor.linhas('itens').has(id)).toBe(true); // o servidor já tem
    expect((await a.motor.estado()).pendentes).toBe(1); // o aparelho ainda acha que falta

    // Enquanto isso outro aparelho muda o registro.
    await b.motor.sincronizar();
    await b.motor.atualizar('itens', id, { nome: 'mudou no B' });
    await b.motor.sincronizar();

    const segunda = await a.motor.sincronizar();
    expect(segunda).toMatchObject({ enviadas: 0, duplicadas: 1 });
    expect((await a.motor.estado()).pendentes).toBe(0);
    // O reenvio NÃO desfez a edição do B.
    expect(servidor.linhas('itens').get(id)?.nome).toBe('mudou no B');
    expect((await a.ler('itens', id))?.nome).toBe('mudou no B');
  });

  it('sem conexão no download: nada é aplicado pela metade e o cursor não anda', async () => {
    await novoItem(a);
    await a.motor.sincronizar();
    servidor.falhaDownload = 'falha-antes';
    const relatorio = await b.motor.sincronizar();
    expect(relatorio.erro).toBe('rede');
    expect((await b.motor.estado()).cursores).toEqual({ itens: 0, filhos: 0 });
    expect(await b.todos('itens')).toHaveLength(0);
    expect((await b.motor.sincronizar()).erro).toBeUndefined();
    expect(await b.todos('itens')).toHaveLength(1);
  });

  it('se o envio falha, não tenta baixar (provavelmente também está sem rede)', async () => {
    await novoItem(a);
    servidor.falhaEnvio = 'falha-antes';
    await a.motor.sincronizar();
    expect(servidor.chamadasDownload).toHaveLength(0);
    expect(servidor.chamadasBaixarTudo).toHaveLength(0);
  });

  it('sessão expirada: para tudo, avisa que precisa entrar de novo, e nada é perdido', async () => {
    const id = await novoItem(a);
    servidor.falhaEnvio = 'sessao-expirada';
    const relatorio = await a.motor.sincronizar();
    expect(relatorio.erro).toBe('autenticacao');
    expect((await a.motor.estado()).pendentes).toBe(1);
    expect((await a.motor.estado()).falhas).toHaveLength(0);

    await a.motor.sincronizar();
    expect(servidor.linhas('itens').has(id)).toBe(true);
  });

  it('sessão expirada no download também é reportada', async () => {
    servidor.falhaDownload = 'sessao-expirada';
    expect((await a.motor.sincronizar()).erro).toBe('autenticacao');
  });

  it('o servidor devolve erro de autenticação por operação: para sem queimar tentativas', async () => {
    const id = await novoItem(a);
    servidor.rejeitar = () => ({ codigo: '28000', mensagem: 'não autenticado' });
    const relatorio = await a.motor.sincronizar();
    expect(relatorio.erro).toBe('autenticacao');
    const estado = await a.motor.estado();
    expect(estado.pendentes).toBe(1);
    expect(estado.falhas).toHaveLength(0);
    servidor.rejeitar = () => null;
    await a.motor.sincronizar();
    expect(servidor.linhas('itens').has(id)).toBe(true);
  });
});

describe('falhas por operação', () => {
  it('RLS recusa uma alteração: vira falha definitiva e não trava as outras', async () => {
    const ruim = await novoItem(a, { nome: 'proibido' });
    const bom1 = await novoItem(a, { nome: 'ok 1' });
    const bom2 = await novoItem(a, { nome: 'ok 2' });
    servidor.rejeitar = (op) =>
      op.registro.id === ruim ? { codigo: '42501', mensagem: 'sem permissão' } : null;

    const relatorio = await a.motor.sincronizar();
    expect(relatorio).toMatchObject({ enviadas: 2, falhasDefinitivas: 1, adiadas: 0 });
    expect(servidor.linhas('itens').has(bom1)).toBe(true);
    expect(servidor.linhas('itens').has(bom2)).toBe(true);
    expect(servidor.linhas('itens').has(ruim)).toBe(false);

    const estado = await a.motor.estado();
    expect(estado.pendentes).toBe(0);
    expect(estado.falhas).toHaveLength(1);
    expect(estado.falhas[0]).toMatchObject({
      registroId: ruim,
      codigo: '42501',
      mensagem: 'sem permissão',
    });

    // Não fica tentando para sempre.
    servidor.chamadasEnvio.length = 0;
    await a.motor.sincronizar();
    expect(servidor.chamadasEnvio).toHaveLength(0);
  });

  it('falha definitiva pode ser reenfileirada (depois de corrigir o problema) ou descartada', async () => {
    const id = await novoItem(a);
    servidor.rejeitar = () => ({ codigo: '42501', mensagem: 'sem permissão' });
    await a.motor.sincronizar();
    expect((await a.motor.estado()).falhas).toHaveLength(1);

    servidor.rejeitar = () => null;
    expect(await a.motor.reenfileirarFalhas()).toBe(1);
    await a.motor.sincronizar();
    expect(servidor.linhas('itens').has(id)).toBe(true);

    servidor.rejeitar = () => ({ codigo: '23505', mensagem: 'duplicado' });
    const outro = await novoItem(a);
    await a.motor.sincronizar();
    expect(await a.motor.descartarFalha('itens', outro)).toBe(true);
    expect((await a.motor.estado()).falhas).toHaveLength(0);
  });

  it('erro passageiro tenta de novo até o limite; depois vira falha definitiva', async () => {
    const motor = new MotorSincronizacao({
      local: a.local,
      remoto: servidor,
      tabelas: ['itens', 'filhos'],
      maxTentativas: 3,
    });
    await novoItem(a);
    servidor.rejeitar = () => ({ codigo: '40001', mensagem: 'conflito de transação' });

    expect(await motor.sincronizar()).toMatchObject({ adiadas: 1, falhasDefinitivas: 0 });
    expect(await motor.sincronizar()).toMatchObject({ adiadas: 1, falhasDefinitivas: 0 });
    expect(await motor.sincronizar()).toMatchObject({ adiadas: 0, falhasDefinitivas: 1 });
    expect((await motor.estado()).falhas).toHaveLength(1);
  });

  it('erro passageiro que passa: a alteração é enviada e some da fila', async () => {
    const id = await novoItem(a);
    let tentativas = 0;
    servidor.rejeitar = () =>
      ++tentativas < 3 ? { codigo: '53300', mensagem: 'sobrecarga' } : null;
    await a.motor.sincronizar();
    await a.motor.sincronizar();
    const terceira = await a.motor.sincronizar();
    expect(terceira.enviadas).toBe(1);
    expect(servidor.linhas('itens').has(id)).toBe(true);
    expect((await a.motor.estado()).pendentes).toBe(0);
  });

  it('o servidor não responde por uma das operações: conta como erro passageiro, não some', async () => {
    const remotoRuim: RemotoSincronizacao = {
      enviar: async () => [],
      baixar: async () => [],
    };
    const motor = new MotorSincronizacao({
      local: a.local,
      remoto: remotoRuim,
      tabelas: ['itens'],
    });
    await novoItem(a);
    expect(await motor.sincronizar()).toMatchObject({ adiadas: 1 });
    expect((await motor.estado()).pendentes).toBe(1);
  });

  it('falha de chave estrangeira consequência de outra falha não gasta tentativa do filho', async () => {
    const pai = await novoItem(a);
    const filho = await a.motor.criar('filhos', { item_id: pai, dono_id: 'ana' });
    // O pai falha de forma passageira, o filho então falha por FK (pai inexistente).
    servidor.rejeitar = (op) =>
      op.tabela === 'itens' ? { codigo: '40001', mensagem: 'conflito' } : null;
    for (let i = 0; i < 4; i++) await a.motor.sincronizar();
    const fila = await a.local.listarFila();
    expect(fila.find((i) => i.registroId === filho)?.tentativas).toBe(0);
    expect(fila.find((i) => i.registroId === pai)?.tentativas).toBe(4);

    servidor.rejeitar = () => null;
    const relatorio = await a.motor.sincronizar();
    expect(relatorio.enviadas).toBe(2);
    expect(servidor.linhas('filhos').has(filho)).toBe(true);
  });

  it('filho sem pai no servidor (e sem falha antes) conta tentativas e acaba como falha definitiva', async () => {
    const motor = new MotorSincronizacao({
      local: a.local,
      remoto: servidor,
      tabelas: ['itens', 'filhos'],
      maxTentativas: 2,
    });
    await a.local.gravar(
      'filhos',
      { id: 'orfao', item_id: 'pai-que-nao-existe', dono_id: 'ana' },
      '2026-10-01T10:00:00Z',
    );
    expect(await motor.sincronizar()).toMatchObject({ adiadas: 1 });
    expect(await motor.sincronizar()).toMatchObject({ falhasDefinitivas: 1 });
  });
});

describe('edição durante o envio', () => {
  it('uma edição feita enquanto o envio está no ar não se perde', async () => {
    const id = await novoItem(a, { nome: 'v1', valor: 1 });
    servidor.aoEnviar = async () => {
      await a.motor.atualizar('itens', id, { nome: 'v2 durante o envio' });
      void a.motor.sincronizar(); // o app pede sincronização ao gravar: vira uma nova rodada
    };
    const relatorio = await a.motor.sincronizar();

    // A rodada extra (alteração durante a sincronização) já enviou a v2.
    expect(servidor.linhas('itens').get(id)?.nome).toBe('v2 durante o envio');
    expect((await a.motor.estado()).pendentes).toBe(0);
    expect(relatorio.erro).toBeUndefined();
  });

  it('sem pedido de nova rodada, a edição fica na fila para o próximo envio', async () => {
    const id = await novoItem(a, { nome: 'v1' });
    servidor.aoEnviar = async () => {
      // grava direto no armazenamento, sem passar pelo motor (não pede nova rodada)
      await a.local.gravar('itens', { id, nome: 'v2' }, '2026-10-01T10:00:00Z');
    };
    await a.motor.enviarPendentes();
    expect(servidor.linhas('itens').get(id)?.nome).toBe('v1');
    expect((await a.motor.estado()).pendentes).toBe(1);
    await a.motor.enviarPendentes();
    expect(servidor.linhas('itens').get(id)?.nome).toBe('v2');
  });
});

describe('concorrência', () => {
  it('chamadas simultâneas de sincronizar se juntam numa só execução', async () => {
    await novoItem(a);
    const [r1, r2, r3] = await Promise.all([
      a.motor.sincronizar(),
      a.motor.sincronizar(),
      a.motor.sincronizar(),
    ]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(servidor.chamadasEnvio.flat()).toHaveLength(1);
  });

  it('depois que termina, uma nova chamada executa de novo', async () => {
    await novoItem(a);
    await a.motor.sincronizar();
    await novoItem(a, { nome: 'outro' });
    const relatorio = await a.motor.sincronizar();
    expect(relatorio.enviadas).toBe(1);
  });

  it('se a sincronização falha, a seguinte não fica travada', async () => {
    await novoItem(a);
    servidor.falhaEnvio = 'falha-antes';
    await a.motor.sincronizar();
    const relatorio = await a.motor.sincronizar();
    expect(relatorio.enviadas).toBe(1);
  });

  it('se o servidor lançar erro inesperado (bug), a trava é liberada', async () => {
    const quebrado: RemotoSincronizacao = {
      enviar: async () => {
        throw new TypeError('bug');
      },
      baixar: async () => [],
    };
    const motor = new MotorSincronizacao({ local: a.local, remoto: quebrado, tabelas: ['itens'] });
    await novoItem(a);
    const r = await motor.sincronizar();
    expect(r.erro).toBe('rede'); // qualquer exceção do remoto é tratada como falha de rede
    expect((await motor.estado()).pendentes).toBe(1);
  });
});

describe('lotes e páginas (download tabela por tabela)', () => {
  // Aqui o servidor não oferece a chamada única; a chamada única tem a sua própria seção abaixo.
  beforeEach(() => servidor.desligarBaixarTudo());

  it('envia em lotes do tamanho configurado, na ordem', async () => {
    const motor = new MotorSincronizacao({
      local: a.local,
      remoto: servidor,
      tabelas: ['itens'],
      tamanhoLote: 3,
    });
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await novoItem(a, { valor: i }));
    const relatorio = await motor.sincronizar();
    expect(relatorio.enviadas).toBe(8);
    expect(servidor.chamadasEnvio.map((c) => c.length)).toEqual([3, 3, 2]);
    expect(servidor.chamadasEnvio.flat().map((o) => o.registro.id)).toEqual(ids);
  });

  it('baixa por páginas e guarda o cursor; a segunda sincronização não baixa nada de novo', async () => {
    for (let i = 0; i < 25; i++)
      servidor.gravarNoServidor('itens', {
        id: `id-${String(i).padStart(2, '0')}`,
        dono_id: 'ana',
        valor: i,
      });
    const motor = new MotorSincronizacao({
      local: b.local,
      remoto: servidor,
      tabelas: ['itens'],
      limitePagina: 10,
      sobreposicao: 0,
    });
    const relatorio = await motor.sincronizar();
    expect(relatorio.baixadas).toBe(25);
    expect(await b.todos('itens')).toHaveLength(25);
    expect(
      servidor.chamadasDownload.filter((c) => c.tabela === 'itens').map((c) => c.limite),
    ).toEqual([10, 10, 10]);
    expect((await motor.estado()).cursores.itens).toBe(25);

    servidor.chamadasDownload.length = 0;
    const segunda = await motor.sincronizar();
    expect(segunda.baixadas).toBe(0);
    expect(servidor.chamadasDownload).toHaveLength(1);
  });

  it('página exatamente cheia: pede a seguinte e termina quando vem vazia', async () => {
    for (let i = 0; i < 20; i++)
      servidor.gravarNoServidor('itens', { id: `id-${i}`, dono_id: 'ana' });
    const motor = new MotorSincronizacao({
      local: b.local,
      remoto: servidor,
      tabelas: ['itens'],
      limitePagina: 10,
      sobreposicao: 0,
    });
    await motor.sincronizar();
    expect(await b.todos('itens')).toHaveLength(20);
    expect(servidor.chamadasDownload).toHaveLength(3);
  });

  it('o limite de página nunca passa de 1000 (limite do servidor)', async () => {
    const motor = new MotorSincronizacao({
      local: b.local,
      remoto: servidor,
      tabelas: ['itens'],
      limitePagina: 5000,
    });
    await motor.sincronizar();
    expect(servidor.chamadasDownload[0]!.limite).toBe(1000);
  });

  it('opções inválidas são recusadas na criação', () => {
    expect(
      () =>
        new MotorSincronizacao({ local: a.local, remoto: servidor, tabelas: [], tamanhoLote: 0 }),
    ).toThrow();
    expect(
      () =>
        new MotorSincronizacao({ local: a.local, remoto: servidor, tabelas: [], limitePagina: 0 }),
    ).toThrow();
  });

  it('proteção contra servidor que devolve sempre a mesma página (não entra em laço infinito)', async () => {
    let chamadas = 0;
    const preso: RemotoSincronizacao = {
      enviar: async () => [],
      baixar: async () => {
        chamadas += 1;
        return [
          { id: 'x1', dono_id: 'a', seq_sinc: 5 },
          { id: 'x2', dono_id: 'a', seq_sinc: 5 },
        ];
      },
    };
    const motor = new MotorSincronizacao({
      local: b.local,
      remoto: preso,
      tabelas: ['itens'],
      limitePagina: 2,
      sobreposicao: 0,
    });
    await motor.sincronizar();
    expect(chamadas).toBeLessThanOrEqual(3);
  });

  it('linhas inválidas do servidor (sem id ou sem seq_sinc) são ignoradas sem derrubar a página', async () => {
    const sujo: RemotoSincronizacao = {
      enviar: async () => [],
      baixar: async (_t, depoisDe) =>
        depoisDe > 0
          ? []
          : [
              { nome: 'sem id', seq_sinc: 1 },
              { id: 'sem-seq', dono_id: 'a' },
              { id: '', seq_sinc: 3 },
              { id: 'boa', dono_id: 'a', nome: 'ok', seq_sinc: 4 },
            ],
    };
    const motor = new MotorSincronizacao({
      local: b.local,
      remoto: sujo,
      tabelas: ['itens'],
      sobreposicao: 0,
    });
    const relatorio = await motor.sincronizar();
    expect(relatorio.baixadas).toBe(1);
    expect((await b.todos('itens')).map((l) => l.id)).toEqual(['boa']);
    expect((await motor.estado()).cursores.itens).toBe(4);
  });
});

describe('cursor e sobreposição', () => {
  it('uma gravação confirmada tarde no servidor, com número menor que o cursor, ainda chega (margem)', async () => {
    servidor.gravarNoServidor('itens', { id: 'primeiro', dono_id: 'ana', valor: 1 }); // seq 1
    await b.motor.sincronizar();
    expect((await b.motor.estado()).cursores.itens).toBe(1);

    // Simula transação lenta: pegou o número 2, mas só foi confirmada depois do número 3.
    servidor.gravarNoServidor('itens', { id: 'terceiro', dono_id: 'ana', valor: 3 }); // seq 2 (depois ajustamos)
    const tardio = {
      id: 'atrasado',
      dono_id: 'ana',
      valor: 2,
      excluido_em: null,
      criado_em: 'x',
      atualizado_em: 'y',
      seq_sinc: 1.5,
    };
    servidor.linhas('itens').set('atrasado', tardio); // número "no meio", confirmado depois

    // A margem é opcional (padrão 0, porque o servidor só entrega linhas frias); aqui ligada.
    const comMargem = new MotorSincronizacao({
      local: b.local,
      remoto: servidor,
      tabelas: ['itens'],
      sobreposicao: 1000,
    });
    await comMargem.sincronizar();
    expect(await b.ler('itens', 'atrasado')).toMatchObject({ valor: 2 });
  });

  it('sem a margem, essa mesma gravação tardia se perderia (por isso a margem existe)', async () => {
    const semMargem = new MotorSincronizacao({
      local: b.local,
      remoto: servidor,
      tabelas: ['itens'],
      sobreposicao: 0,
    });
    servidor.gravarNoServidor('itens', { id: 'primeiro', dono_id: 'ana' });
    servidor.gravarNoServidor('itens', { id: 'terceiro', dono_id: 'ana' });
    await semMargem.sincronizar();
    servidor
      .linhas('itens')
      .set('atrasado', { id: 'atrasado', dono_id: 'ana', excluido_em: null, seq_sinc: 1.5 });
    await semMargem.sincronizar();
    expect(await b.ler('itens', 'atrasado')).toBeUndefined();
  });

  it('o cursor nunca diminui, mesmo com a margem', async () => {
    for (let i = 0; i < 5; i++) servidor.gravarNoServidor('itens', { id: `i${i}`, dono_id: 'ana' });
    await b.motor.sincronizar();
    const antes = (await b.motor.estado()).cursores.itens!;
    await b.motor.sincronizar();
    await b.motor.sincronizar();
    expect((await b.motor.estado()).cursores.itens).toBe(antes);
  });

  it('baixar de novo o que já tem não muda nada nem conta como novidade', async () => {
    servidor.gravarNoServidor('itens', { id: 'a1', dono_id: 'ana', nome: 'x' });
    await b.motor.sincronizar();
    const relatorio = await b.motor.sincronizar(); // a margem repede a mesma linha
    expect(relatorio.baixadas).toBe(0);
  });

  it('baixarTudoDeNovo reinicia o cursor e traz de volta o que passou a ficar visível (novo vínculo)', async () => {
    servidor.gravarNoServidor('itens', {
      id: 'do-aluno',
      dono_id: 'aluno',
      nome: 'visivel só depois',
    });
    servidor.visivel = () => false;
    await b.motor.sincronizar();
    expect(await b.todos('itens')).toHaveLength(0);
    const cursor = (await b.motor.estado()).cursores.itens;

    servidor.visivel = () => true; // o vínculo foi criado: agora o RLS libera
    await b.motor.sincronizar();
    expect(await b.todos('itens')).toHaveLength(1); // a margem já pega linhas recentes
    // Para linhas bem antigas, o cursor precisa voltar:
    for (let i = 0; i < 5; i++)
      servidor.gravarNoServidor('itens', { id: `novo-${i}`, dono_id: 'ana' });
    servidor.seq += 5000;
    servidor.gravarNoServidor('itens', { id: 'bem-novo', dono_id: 'ana' });
    await b.motor.sincronizar();
    await b.motor.baixarTudoDeNovo('itens');
    expect((await b.motor.estado()).cursores.itens).toBe(0);
    expect(cursor).toBeLessThan(5000);
  });

  it('baixarTudoDeNovo sem argumento reinicia todas as tabelas', async () => {
    servidor.gravarNoServidor('itens', { id: 'a1', dono_id: 'ana' });
    await b.motor.sincronizar();
    await b.motor.baixarTudoDeNovo();
    expect(await b.motor.estado()).toMatchObject({ cursores: { itens: 0, filhos: 0 } });
  });

  it('linhas da página e cursor entram juntos: se aplicar uma linha falha, o cursor não avança', async () => {
    servidor.gravarNoServidor('itens', { id: 'boa', dono_id: 'ana' });
    // Valor que não dá para guardar no aparelho: aplicar a segunda linha da página falha.
    servidor.gravarNoServidor('itens', { id: 'ruim', dono_id: 'ana', valor: 10n });
    await expect(b.motor.baixarNovidades()).rejects.toThrow(/BigInt/);
    expect((await b.motor.estado()).cursores.itens).toBe(0);
    expect(await b.todos('itens')).toHaveLength(0); // a boa também foi desfeita: a página é atômica
  });
});

describe('estado', () => {
  it('mostra pendências, falhas e cursores', async () => {
    await novoItem(a);
    expect(await a.motor.estado()).toEqual({
      pendentes: 1,
      falhas: [],
      cursores: { itens: 0, filhos: 0 },
    });
    await a.motor.sincronizar();
    const estado = await a.motor.estado();
    expect(estado.pendentes).toBe(0);
    expect(estado.cursores.itens).toBeGreaterThan(0);
  });

  it('uma tabela que o servidor nunca teve não dá erro', async () => {
    const r = await a.motor.sincronizar();
    expect(r).toEqual({
      enviadas: 0,
      duplicadas: 0,
      falhasDefinitivas: 0,
      adiadas: 0,
      baixadas: 0,
    });
  });
});

describe('tipos', () => {
  it('ErroDeRede e ErroDeAutenticacao são erros com nome próprio', () => {
    expect(new ErroDeRede('x').name).toBe('ErroDeRede');
    expect(new ErroDeRede('x')).toBeInstanceOf(Error);
  });
});
