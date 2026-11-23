// Painel de skills (/skills). Esc fecha, setas navegam, Enter força a skill selecionada.
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Skill } from '../../skills/index.js';

interface SkillsPanelProps {
  skills: readonly Skill[];
  activeIds: string[];     // skills usadas na última resposta
  forcedIds: string[];     // skills forçadas para a próxima mensagem
  enabled: boolean;        // sistema ligado/desligado
  onForce: (id: string) => void;
  onClose: () => void;
}

export function SkillsPanel({ skills, activeIds, forcedIds, enabled, onForce, onClose }: SkillsPanelProps) {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.escape) onClose();
    else if (key.upArrow) setCursor((c) => (c - 1 + skills.length) % skills.length);
    else if (key.downArrow) setCursor((c) => (c + 1) % skills.length);
    else if (key.return) {
      const selected = skills[cursor];
      if (selected && selected.id !== 'core') onForce(selected.id);
    }
  });

  const current = skills[cursor];

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} flexGrow={1} overflow="hidden">
      <Text bold wrap="truncate-end">Skills {enabled ? '(ligado)' : '(desligado)'}</Text>
      {skills.map((skill, i) => {
        const active = activeIds.includes(skill.id);
        const forced = forcedIds.includes(skill.id);
        return (
          <Text key={skill.id} inverse={i === cursor} wrap="truncate-end">
            {i === cursor ? '› ' : '  '}
            {skill.id.padEnd(13)}
            {skill.category.padEnd(13)}
            {forced ? 'forçada' : active ? 'ativa' : ''}
          </Text>
        );
      })}
      {current ? <Text dimColor wrap="truncate-end">{current.name}: {current.description}</Text> : null}
      <Text dimColor wrap="truncate-end">↑↓ navegar · Enter forçar · Esc fechar</Text>
    </Box>
  );
}
