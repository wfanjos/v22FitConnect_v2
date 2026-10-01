import { screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { setThemeMode } from '@/preferences';
import { renderThemed } from '@/test/render';

import { Button } from '../button';
import { EmptyState } from '../empty-state';

describe('EmptyState', () => {
  beforeEach(() => setThemeMode('dark'));

  it('o título tem role header', async () => {
    await renderThemed(<EmptyState title="Nada por aqui" />);
    expect(screen.getByRole('header')).toHaveTextContent('Nada por aqui');
  });

  it('mostra a descrição só quando informada', async () => {
    const { rerender } = await renderThemed(<EmptyState title="Nada por aqui" />);
    expect(screen.queryByText('Crie sua primeira série')).not.toBeOnTheScreen();
    await rerender(<EmptyState title="Nada por aqui" description="Crie sua primeira série" />);
    expect(screen.getByText('Crie sua primeira série')).toBeOnTheScreen();
  });

  it('renderiza as ações recebidas como filhos', async () => {
    await renderThemed(
      <EmptyState title="Nada por aqui">
        <Button label="Criar série" />
        <Button label="Importar" variant="outline" />
      </EmptyState>,
    );
    expect(screen.getByRole('button', { name: 'Criar série' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Importar' })).toBeOnTheScreen();
  });

  it('sem filhos não renderiza botões', async () => {
    await renderThemed(<EmptyState title="Nada por aqui" />);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('sem ilustração usa o símbolo da harpia (SVG)', async () => {
    const { toJSON } = await renderThemed(<EmptyState title="Nada por aqui" />);
    expect(JSON.stringify(toJSON())).toContain('RNSVGSvgView');
  });

  it('ilustração informada substitui o símbolo padrão', async () => {
    const { toJSON } = await renderThemed(
      <EmptyState title="Nada por aqui" illustration={<RNText>mascote-teste</RNText>} />,
    );
    expect(screen.getByText('mascote-teste')).toBeOnTheScreen();
    expect(JSON.stringify(toJSON())).not.toContain('RNSVGSvgView');
  });
});
