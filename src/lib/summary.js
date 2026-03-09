export function createDefaultRunSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'result', 'status', 'highlights', 'next_steps', 'risks', 'validation', 'changed_files', 'findings'],
    properties: {
      title: { type: 'string' },
      result: { type: 'string' },
      status: {
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'partial']
      },
      highlights: {
        type: 'array',
        items: { type: 'string' }
      },
      next_steps: {
        type: 'array',
        items: { type: 'string' }
      },
      risks: {
        type: 'array',
        items: { type: 'string' }
      },
      validation: {
        type: 'array',
        items: { type: 'string' }
      },
      changed_files: {
        type: 'array',
        items: { type: 'string' }
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['priority', 'title', 'location', 'detail'],
          properties: {
            priority: { type: 'string' },
            title: { type: 'string' },
            location: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'start_line', 'end_line'],
              properties: {
                path: { type: 'string' },
                start_line: { type: 'integer' },
                end_line: { type: 'integer' }
              }
            },
            detail: { type: 'string' }
          }
        }
      }
    }
  };
}

export function normalizeSummary(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      title: fallback.title || 'Command completed',
      result: fallback.result || 'The command finished without a structured summary.',
      status: fallback.status || 'completed',
      highlights: fallback.highlights || [],
      next_steps: fallback.next_steps || [],
      risks: fallback.risks || [],
      validation: fallback.validation || [],
      changed_files: fallback.changed_files || [],
      findings: fallback.findings || []
    };
  }

  return {
    title: asString(value.title, fallback.title || 'Command completed'),
    result: asString(value.result, fallback.result || 'The command completed.'),
    status: asString(value.status, fallback.status || 'completed'),
    highlights: withFallback(asStringList(value.highlights), fallback.highlights),
    next_steps: withFallback(asStringList(value.next_steps), fallback.next_steps),
    risks: withFallback(asStringList(value.risks), fallback.risks),
    validation: withFallback(asStringList(value.validation), fallback.validation),
    changed_files: withFallback(asStringList(value.changed_files), fallback.changed_files),
    findings: withFallback(asFindingList(value.findings), fallback.findings)
  };
}

export function renderHumanSummary(summary) {
  const lines = [`${summary.title}`, '', summary.result];

  if (summary.highlights?.length) {
    lines.push('', 'Highlights:');
    for (const item of summary.highlights) {
      lines.push(`- ${item}`);
    }
  }

  if (summary.findings?.length) {
    lines.push('', 'Findings:');
    for (const item of summary.findings) {
      lines.push(...renderFinding(item));
    }
  }

  if (summary.next_steps?.length) {
    lines.push('', 'Next steps:');
    for (const item of summary.next_steps) {
      lines.push(`- ${item}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function renderFinding(item) {
  if (typeof item === 'string' && item.trim()) {
    return [`- ${item}`];
  }

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return [];
  }

  const priority = typeof item.priority === 'string' && item.priority.trim() ? `[${item.priority.trim()}] ` : '';
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Untitled finding';
  const location = formatFindingLocation(item.location);
  const header = `- ${priority}${title}${location ? ` (${location})` : ''}`;
  const detail = typeof item.detail === 'string' ? item.detail.trim() : '';

  if (!detail) {
    return [header];
  }

  return [header, ...detail.split('\n').map((line) => `  ${line}`)];
}

function formatFindingLocation(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    return '';
  }

  const filePath = typeof location.path === 'string' ? location.path.trim() : '';
  const startLine = Number.isInteger(location.start_line) ? location.start_line : null;
  const endLine = Number.isInteger(location.end_line) ? location.end_line : startLine;

  if (!filePath) {
    return '';
  }

  if (!startLine) {
    return filePath;
  }

  return `${filePath}:${startLine}-${endLine}`;
}

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === 'string' && item.trim());
}

function asFindingList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => {
    if (typeof item === 'string' && item.trim()) {
      return true;
    }

    return isStructuredFinding(item);
  });
}

function isStructuredFinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return [value.priority, value.title, value.detail].some((item) => typeof item === 'string' && item.trim()) || isFindingLocation(value.location);
}

function isFindingLocation(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && ((typeof value.path === 'string' && value.path.trim()) || Number.isInteger(value.start_line) || Number.isInteger(value.end_line)));
}

function withFallback(list, fallback) {
  return list.length ? list : Array.isArray(fallback) ? fallback : [];
}
