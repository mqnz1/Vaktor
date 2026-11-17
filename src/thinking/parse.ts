// Separa raciocínio e resposta final. Nunca devolve tags no answer.
const TAGS = 'thinking|think|reasoning|thought'; // "think" cobre o formato do DeepSeek R1

// Regexes criadas a cada chamada (a flag g guarda estado)
const closedTag = (): RegExp => new RegExp(`<(${TAGS})>([\\s\\S]*?)<\\/\\1>`, 'gi');
const closedFence = (): RegExp => /```thinking[^\n]*\n([\s\S]*?)```/gi;
const openTag = (): RegExp => new RegExp(`<(?:${TAGS})>`, 'i');
const closeTag = (): RegExp => new RegExp(`<\\/(?:${TAGS})>`, 'i');
const openFence = (): RegExp => /```thinking[^\n]*\n/i;
const anyTag = (): RegExp => new RegExp(`<\\/?(?:${TAGS})>`, 'gi');

export function extractThinking(text: string): { reasoning: string; answer: string } {
  const parts: string[] = [];
  let rest = text;

  // 1) blocos fechados (tag ou fence)
  rest = rest.replace(closedTag(), (_m: string, _t: string, body: string) => {
    parts.push(body.trim());
    return '';
  });
  rest = rest.replace(closedFence(), (_m: string, body: string) => {
    parts.push(body.trim());
    return '';
  });

  // 2) bloco aberto e nunca fechado: o que vem depois é raciocínio
  const open = openTag().exec(rest) ?? openFence().exec(rest);
  if (open) {
    parts.push(rest.slice(open.index + open[0].length).trim());
    rest = rest.slice(0, open.index);
  } else {
    // 3) fechamento órfão (ex.: "...raciocínio</think>resposta")
    const close = closeTag().exec(rest);
    if (close) {
      parts.push(rest.slice(0, close.index).trim());
      rest = rest.slice(close.index + close[0].length);
    }
  }

  const reasoning = parts.filter((p) => p.length > 0).join('\n\n');
  // 4) nunca retornar tag no answer
  let answer = rest.replace(anyTag(), '').replace(/```thinking[^\n]*\n?/gi, '').trim();

  // Fallback seguro: nunca devolver resposta vazia
  if (answer.length === 0) answer = reasoning.length > 0 ? reasoning : text.replace(anyTag(), '').trim();

  return { reasoning, answer };
}

// Remove qualquer tag/fence de thinking de um texto (usado na exibição)
export function stripThinkingTags(text: string): string {
  return text.replace(anyTag(), '').replace(/```thinking[^\n]*\n?/gi, '').trim();
}
