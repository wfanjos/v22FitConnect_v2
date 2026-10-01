import { fireEvent, screen } from '@testing-library/react-native';
import { border, darkColors } from '@v22/ui';
import { StyleSheet, Text } from 'react-native';

import { setThemeMode } from '@/preferences';
import { renderThemed } from '@/test/render';

import { List, ListItem } from '../list';

// Cada filho da List é embrulhado numa View que carrega a divisória; sobe até ela.
const wrapperStyle = (title: string) => {
  let node = screen.getByText(title).parent;
  while (node && StyleSheet.flatten(node.props.style)?.borderBottomWidth === undefined) {
    node = node.parent;
  }
  return StyleSheet.flatten(node!.props.style);
};

describe('List', () => {
  beforeEach(() => setThemeMode('dark'));

  it('põe divisória entre os itens e nenhuma depois do último', async () => {
    await renderThemed(
      <List>
        <ListItem key="a" title="A" />
        <ListItem key="b" title="B" />
        <ListItem key="c" title="C" />
      </List>,
    );
    expect(wrapperStyle('A').borderBottomWidth).toBe(border.hairline);
    expect(wrapperStyle('A').borderBottomColor).toBe(darkColors.line);
    expect(wrapperStyle('B').borderBottomWidth).toBe(border.hairline);
    expect(wrapperStyle('C').borderBottomWidth).toBe(0);
  });

  it('com um único item não tem divisória', async () => {
    await renderThemed(
      <List>
        <ListItem title="Só" />
      </List>,
    );
    expect(wrapperStyle('Só').borderBottomWidth).toBe(0);
  });

  it('lista vazia renderiza sem erro', async () => {
    await renderThemed(<List>{[]}</List>);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('com keys estáveis, reordenar move a divisória junto com a posição', async () => {
    const items = (order: string[]) => (
      <List>
        {order.map((id) => (
          <ListItem key={id} title={id} />
        ))}
      </List>
    );
    const { rerender } = await renderThemed(items(['A', 'B', 'C']));
    await rerender(items(['C', 'B', 'A']));
    expect(wrapperStyle('C').borderBottomWidth).toBe(border.hairline);
    expect(wrapperStyle('A').borderBottomWidth).toBe(0);
  });
});

describe('ListItem', () => {
  beforeEach(() => setThemeMode('dark'));

  it('mostra título e subtítulo', async () => {
    await renderThemed(<ListItem title="Supino" subtitle="3 x 10" />);
    expect(screen.getByText('Supino')).toBeOnTheScreen();
    expect(screen.getByText('3 x 10')).toBeOnTheScreen();
  });

  it('sem subtítulo só renderiza o título', async () => {
    await renderThemed(<ListItem title="Supino" />);
    expect(screen.getAllByText(/./)).toHaveLength(1);
  });

  it('sem onPress não é botão', async () => {
    await renderThemed(<ListItem title="Supino" />);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('com onPress vira botão e dispara o callback', async () => {
    const onPress = jest.fn();
    await renderThemed(<ListItem title="Supino" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exibe o trailing quando passado', async () => {
    await renderThemed(<ListItem title="Supino" trailing={<Text>trailing-teste</Text>} />);
    expect(screen.getByText('trailing-teste')).toBeOnTheScreen();
  });
});
