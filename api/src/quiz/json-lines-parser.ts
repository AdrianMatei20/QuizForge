/**
 * Splits streamed text into complete lines (JSON Lines). Chunks can end
 * anywhere, even mid-line, so the unfinished part is kept until the next
 * chunk completes it. Blank lines and Markdown code-fence lines (``` or
 * ```json), which models sometimes add despite instructions, are dropped.
 * It only splits: whether a line is valid JSON is the caller's business.
 */
export class JsonLinesParser {
  private buffer = '';

  /** Adds a chunk; returns the lines it completed, in order. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split('\n');
    // The last part has no newline yet: keep it for the next chunk.
    this.buffer = parts.pop() ?? '';
    return parts.flatMap(keep);
  }

  /** Call once the stream has ended: returns the last line if it had no newline. */
  end(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    return keep(rest);
  }
}

const CODE_FENCE = /^```[\w-]*$/;

function keep(line: string): string[] {
  // \r: tolerate CRLF line endings.
  const trimmed = line.replace(/\r$/, '').trim();
  return trimmed === '' || CODE_FENCE.test(trimmed) ? [] : [trimmed];
}
