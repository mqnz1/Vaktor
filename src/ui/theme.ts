export const theme = {
  colors: {
    primary: 'white',
    secondary: 'white',
    muted: 'gray',
    success: 'white',
    warning: 'white',
    error: 'white',
    info: 'white',
    codeMode: 'white',
    chatMode: 'white',
    modelAuto: 'white',
    modelFixed: 'white',
    modelFallback: 'white',
    creditOk: 'white',
    creditWarn: 'white',
    creditLow: 'white',
  },
  symbols: {
    user: '›',
    assistant: '●',
    thinking: '⠋',
    cached: '∞',
    fallback: '↺',
  },
} as const;

export type Theme = typeof theme;
