import React from 'react';
import { Box, Text, useInput } from 'ink';
import { readdirSync, statSync } from 'fs';
import { resolve } from 'path';

interface DirectoryMenuProps {
  workdir: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function DirectoryMenu({ workdir, onSelect, onClose }: DirectoryMenuProps): React.ReactElement {
  const [mode, setMode] = React.useState<'browse' | 'edit'>('browse');
  const [cursor, setCursor] = React.useState(0);
  const [currentPath, setCurrentPath] = React.useState(workdir);
  const [editPath, setEditPath] = React.useState(workdir);
  const [editError, setEditError] = React.useState('');

  // Leituras de disco memorizadas: sem isso o menu refaz readdirSync (e, em
  // "drives://", varre C:..Z:) a cada render — trava o terminal no meio da
  // digitação, porque cada frame da TUI bloqueia no I/O.
  const drives = React.useMemo((): string[] => {
    const list: string[] = [];
    for (let i = 67; i <= 90; i++) {
      const drive = String.fromCharCode(i) + ':';
      try {
        readdirSync(drive);
        list.push(drive);
      } catch {
        // Drive doesn't exist
      }
    }
    return list;
  }, []);

  const browse = React.useMemo((): { items: string[]; error: string } => {
    try {
      const entries = readdirSync(currentPath).filter(name => {
        try {
          return statSync(resolve(currentPath, name)).isDirectory();
        } catch {
          return false;
        }
      });
      return { items: ['..', ...entries.sort()], error: '' };
    } catch (err) {
      return { items: [], error: `Cannot read: ${err instanceof Error ? err.message : String(err)}` };
    }
  }, [currentPath]);

  React.useEffect(() => {
    setCursor(0);
  }, [currentPath]);

  const isRoot = currentPath === 'drives://';
  const items = isRoot ? drives : browse.items;
  const error = mode === 'browse' ? (browse.error || editError) : editError;

  useInput((input, key) => {
    if (mode === 'edit') {
      if (key.escape || key.tab) {
        setMode('browse');
        setEditPath(currentPath);
        setEditError('');
        return;
      }
      if (key.return) {
        try {
          statSync(editPath);
          setCurrentPath(editPath);
          setMode('browse');
          setEditError('');
        } catch {
          setEditError('Path does not exist');
        }
        return;
      }
      if (key.backspace) {
        setEditPath(p => p.slice(0, -1));
        return;
      }
      if (input && !key.escape && !key.return) {
        setEditPath(p => p + input);
      }
      return;
    }

    // Browse mode
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(items.length - 1, c + 1));

    if (key.return) {
      const selected = items[cursor];
      if (!selected) return;

      if (isRoot) {
        setEditError('');
        setCurrentPath(selected + '\\');
      } else if (selected === '..') {
        const parent = resolve(currentPath, '..');
        setEditError('');
        if (parent !== currentPath) {
          setCurrentPath(parent);
        } else {
          setCurrentPath('drives://');
        }
      } else {
        const fullPath = resolve(currentPath, selected);
        try {
          statSync(fullPath);
          onSelect(fullPath);
        } catch {
          setEditError('Cannot access directory');
        }
      }
    }

    if (key.tab) {
      setMode('edit');
      setEditPath(currentPath);
      setEditError('');
    }

    if (key.escape) onClose();
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1} overflow="hidden">
      {mode === 'browse' ? (
        <>
          <Box marginBottom={1}>
            <Text bold>Select Directory</Text>
            <Text dimColor> · ↑↓ navigate · Enter select · Tab edit · Esc close</Text>
          </Box>

          <Box marginBottom={1}>
            <Text dimColor>{isRoot ? 'Drives' : currentPath}</Text>
          </Box>

          {error && (
            <Box marginBottom={1}>
              <Text>{error}</Text>
            </Box>
          )}

          {!items || items.length === 0 ? (
            <Text dimColor>Empty directory</Text>
          ) : (
            items.map((item, i) => {
              const isCursor = i === cursor;
              let label = item;
              if (isRoot) label = item + '\\';
              else if (item === '..') label = '.. (parent)';

              return (
                <Box key={`${item}-${i}`} gap={1}>
                  <Text dimColor={isCursor ? false : true}>
                    {isCursor ? '›' : ' '}
                  </Text>
                  <Text bold={isCursor} dimColor={!isCursor}>{label}</Text>
                </Box>
              );
            })
          )}

          <Box marginTop={1}>
            <Text dimColor>
              ↑↓ navigate · Enter confirm · Tab edit path · Esc close
            </Text>
          </Box>
        </>
      ) : (
        <>
          <Box marginBottom={1}>
            <Text bold>Edit Path</Text>
            <Text dimColor> · Enter confirm · Esc back</Text>
          </Box>

          {error && (
            <Box marginBottom={1}>
              <Text>{error}</Text>
            </Box>
          )}

          <Box marginBottom={1}>
            <Text>
              {editPath}
              <Text bold>█</Text>
            </Text>
          </Box>

          <Text dimColor>Type path · Enter confirm · Esc back</Text>

          <Box marginTop={1}>
            <Text dimColor>Example: C:\Users\elian\Documents</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
