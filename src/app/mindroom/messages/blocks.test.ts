import { describe, expect, it } from 'vitest';
import {
  MINDROOM_TOOL_REF_HTML_REG_G,
  formatMindroomMarkdownTextBodyAsHtml,
  formatMindroomMessageTextBodyAsHtml,
  parseMindroomToolRefHtml,
  parseMindroomToolRefText,
} from './blocks';

const PASTE_MARKER =
  '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]';

describe('MINDROOM_TOOL_REF_HTML_REG_G', () => {
  it('matches the formatted_body marker contract', () => {
    MINDROOM_TOOL_REF_HTML_REG_G.lastIndex = 0;
    const match = MINDROOM_TOOL_REF_HTML_REG_G.exec('🔧 <code>search_web</code> [12] ⏳');

    expect(match?.[1]).toBe('search_web');
    expect(match?.[2]).toBe('12');
    expect(match?.[3]).toBe(' ⏳');
  });
});

describe('parseMindroomToolRefHtml', () => {
  it('parses a pending HTML tool ref marker', () => {
    expect(parseMindroomToolRefHtml('🔧 <code>search_web</code> [1] ⏳')).toEqual({
      toolName: 'search_web',
      index: 1,
      pending: true,
    });
  });

  it('parses a completed HTML tool ref marker', () => {
    expect(parseMindroomToolRefHtml('🔧 <code>read_file</code> [2]')).toEqual({
      toolName: 'read_file',
      index: 2,
      pending: false,
    });
  });

  it('requires the full marker string to match', () => {
    expect(
      parseMindroomToolRefHtml('prefix 🔧 <code>search_web</code> [1] suffix')
    ).toBeUndefined();
  });
});

describe('parseMindroomToolRefText', () => {
  it('parses the plain text body marker contract', () => {
    expect(parseMindroomToolRefText('🔧 `shell` [3]')).toEqual({
      toolName: 'shell',
      index: 3,
      pending: false,
    });
  });

  it('returns undefined for non-marker text', () => {
    expect(parseMindroomToolRefText('normal response text')).toBeUndefined();
  });
});

describe('formatMindroomMessageTextBodyAsHtml', () => {
  it('converts plain text tool marker lines to the formatted marker contract', () => {
    expect(
      formatMindroomMessageTextBodyAsHtml(
        [
          'Before <unsafe>',
          '',
          '🔧 `run_shell_command` [1]',
          '',
          'After & done',
          'same paragraph',
          '🔧 `edit_file` [2] ⏳',
        ].join('\n')
      )
    ).toBe(
      [
        '<p>Before &lt;unsafe&gt;</p>',
        '<p>🔧 <code>run_shell_command</code> [1]</p>',
        '<p>After &amp; done<br/>same paragraph</p>',
        '<p>🔧 <code>edit_file</code> [2] ⏳</p>',
      ].join('')
    );
  });

  it('formats paste markers and keeps tool refs parseable', () => {
    expect(
      formatMindroomMessageTextBodyAsHtml(
        [`Before ${PASTE_MARKER} after`, '', '🔧 `run_shell_command` [1]'].join('\n')
      )
    ).toBe(
      [
        '<p>Before ',
        '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
        '[[mindroom-paste:{&quot;v&quot;:1,&quot;id&quot;:&quot;paste-a3f19c&quot;,&quot;chars&quot;:11,&quot;file&quot;:&quot;mindroom-paste-a3f19c.txt&quot;}]]',
        '</span>',
        ' after</p>',
        '<p>🔧 <code>run_shell_command</code> [1]</p>',
      ].join('')
    );
  });

  it('returns undefined without special MindRoom markers', () => {
    expect(formatMindroomMessageTextBodyAsHtml('plain response')).toBeUndefined();
  });
});

describe('formatMindroomMarkdownTextBodyAsHtml', () => {
  it('renders bold text containing inline code before the sidecar arrives', () => {
    const html = formatMindroomMarkdownTextBodyAsHtml(
      '**2. Pointed `config.yaml` at it** (line 50):'
    );

    expect(html).toBe(
      '<strong data-md="**">2. Pointed <code data-md="`">config.yaml</code> at it</strong> (line 50):'
    );
  });

  it('renders standalone separators while preserving separators in code examples', () => {
    const html = formatMindroomMarkdownTextBodyAsHtml(
      ['Before', '', '---', '', 'After', '', '```text', '---', '```'].join('\n')
    );

    expect(html).toContain('<hr');
    expect(html).toContain('<pre data-md="```"><code class="language-text">---\n</code></pre>');
  });

  it.each(['---', '***', '___', '-----'])('renders a standalone %s separator', (separator) => {
    expect(formatMindroomMarkdownTextBodyAsHtml(separator)).toBe('<hr/>');
  });

  it.each([
    ['```', 'x', '```', '---', '', 'After'],
    ['Before', '', '---', '```', 'x', '```'],
    ['$$', 'x', '$$', '---', '', 'After'],
  ])('treats recognized code and math blocks as separator boundaries', (...lines) => {
    expect(formatMindroomMarkdownTextBodyAsHtml(lines.join('\n'))).toContain('<hr/>');
  });

  it.each(['\\---', '    ---', '> ---', '`---`', 'Heading\n---', '---\nText', '~~~\n\n---\n\n~~~'])(
    'keeps non-standalone or ambiguous separators literal: %s',
    (body) => {
      expect(formatMindroomMarkdownTextBodyAsHtml(body)).not.toContain('<hr');
    }
  );

  it('renders safe Markdown and root tool references', () => {
    expect(
      formatMindroomMarkdownTextBodyAsHtml(
        ['# Preview <unsafe>', '', 'Ready **now**.', '', '🔧 `run_shell_command` [1]'].join('\n')
      )
    ).toBe(
      [
        '<h1 data-md="#">Preview &lt;unsafe&gt;</h1>',
        '<br/>Ready <strong data-md="**">now</strong>.<br/>',
        '<p>🔧 <code>run_shell_command</code> [1]</p>',
      ].join('')
    );
  });

  it('keeps fenced markers literal while promoting tool calls outside the fence', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['```', '🔧 `run_shell_command` [1]', PASTE_MARKER, '```', '', '🔧 `outside_tool` [2]'].join(
        '\n'
      )
    );

    expect(formattedBody).toContain('<pre data-md="```"><code>🔧 `run_shell_command` [1]\n');
    expect(formattedBody).toContain('[[mindroom-paste:{&quot;v&quot;:1');
    expect(formattedBody).not.toContain('data-mindroom-paste-marker');
    expect(formattedBody).toContain('<p>🔧 <code>outside_tool</code> [2]</p>');
    expect(formattedBody).toContain('outside_tool');
  });

  it('groups root tool markers despite unrelated inline code, strike, and math', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      [
        'Update `notes.md`, ~~old~~, and $x$.',
        '',
        '🔧 `read_file` [1]',
        '',
        '🔧 `edit_file` [2]',
      ].join('\n')
    );

    expect(formattedBody).toContain('<code data-md="`">notes.md</code>');
    expect(formattedBody).toContain(
      '<p>🔧 <code>read_file</code> [1]</p><p>🔧 <code>edit_file</code> [2]</p>'
    );
  });

  it('uses the parser code-fence grammar when preserving dash text', () => {
    const infoBacktick = formatMindroomMarkdownTextBodyAsHtml(
      ['```foo`bar', '- item', '```'].join('\n')
    );
    const exactClose = formatMindroomMarkdownTextBodyAsHtml(
      ['```', '- inside one', '````', '- inside two', '```'].join('\n')
    );

    expect(infoBacktick).toContain('<code class="language-foo`bar">- item\n');
    expect(infoBacktick).not.toContain('* item');
    expect(exactClose).toContain('- inside one\n````\n- inside two\n');
    expect(exactClose).not.toContain('* inside');
  });

  it('keeps ambiguous fences guarded across parser-recognized blocks', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['~~~', '```', 'example', '```', '🔧 `example_tool` [1]'].join('\n')
    );

    expect(formattedBody).not.toContain('<p>🔧 <code>example_tool</code> [1]</p>');
    expect(formattedBody).toContain('example_tool');
  });

  it('does not add Markdown escapes to list-shaped tool text inside code fences', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['```', '- 🔧 `tool_name` [1]', '```'].join('\n')
    );

    expect(formattedBody).toContain('- 🔧 `tool_name` [1]');
    expect(formattedBody).not.toContain('\\`tool\\_name\\`');
  });

  it('normalizes dash lists outside parser-recognized code and math blocks', () => {
    const bodies = [
      ['~~~', '- item', '~~~'].join('\n'),
      ['   ```', '- item', '   ```'].join('\n'),
      ['$$', '- item'].join('\n'),
    ];

    bodies.forEach((body) => {
      const formattedBody = formatMindroomMarkdownTextBodyAsHtml(body);

      expect(formattedBody).toContain('<ul data-md="*">');
      expect(formattedBody).not.toContain('<ol');
    });
  });

  it('uses the parser display-math grammar when preserving dash text', () => {
    const sameLineDelimiters = formatMindroomMarkdownTextBodyAsHtml(
      ['$$a', '- b', 'c$$'].join('\n')
    );
    const contentLineClose = formatMindroomMarkdownTextBodyAsHtml(
      ['$$', '- a', 'b$$', '- outside'].join('\n')
    );

    expect(sameLineDelimiters).toContain('data-mx-maths="a\n- b\nc"');
    expect(sameLineDelimiters).not.toContain('* b');
    expect(contentLineClose).toContain('data-mx-maths="- a\nb"');
    expect(contentLineClose).toContain('<ul data-md="*">');
    expect(contentLineClose).not.toContain('<ol');
  });

  it('promotes root markers when earlier inline syntax is escaped', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['Use \\`literal` and \\~~also literal~~.', '', '🔧 `tool` [1]'].join('\n')
    );

    expect(formattedBody).toContain('<p>🔧 <code>tool</code> [1]</p>');
  });

  it('drops blank separators between consecutive tool references', () => {
    expect(
      formatMindroomMarkdownTextBodyAsHtml(
        [
          '🔧 `run_shell_command` [1]',
          '',
          '',
          '🔧 `run_shell_command` [2]',
          '',
          '',
          '🔧 `run_shell_command` [3]',
        ].join('\n')
      )
    ).toBe(
      [
        '<p>🔧 <code>run_shell_command</code> [1]</p>',
        '<p>🔧 <code>run_shell_command</code> [2]</p>',
        '<p>🔧 <code>run_shell_command</code> [3]</p>',
      ].join('')
    );
  });

  it('renders standalone paste markers between Markdown chunks', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['Before **bold**', '', PASTE_MARKER, '', 'After *italic*'].join('\n')
    );

    expect(formattedBody).toContain('<strong data-md="**">bold</strong>');
    expect(formattedBody).toContain('data-mindroom-paste-marker="true"');
    expect(formattedBody).toContain('<i data-md="*">italic</i>');
  });

  it('keeps ambiguous inline, container, and tilde-fence markers literal', () => {
    const inlinePaste = formatMindroomMarkdownTextBodyAsHtml(
      `Before **bold** ${PASTE_MARKER} after`
    );
    const multilineCode = formatMindroomMarkdownTextBodyAsHtml(
      `\`\`before\n${PASTE_MARKER}\nafter\`\``
    );
    const listFence = formatMindroomMarkdownTextBodyAsHtml(
      ['- ~~~', '  🔧 `run_shell_command` [1]', '  ~~~'].join('\n')
    );
    const tildeFence = formatMindroomMarkdownTextBodyAsHtml(
      ['~~~', '🔧 `run_shell_command` [1]', '~~~'].join('\n')
    );

    [inlinePaste, multilineCode, listFence, tildeFence].forEach((formattedBody) => {
      expect(formattedBody).not.toContain('data-mindroom-paste-marker');
      expect(formattedBody).not.toContain('<p>🔧 <code>run_shell_command</code> [1]</p>');
    });
    expect(inlinePaste).toContain('[[mindroom-paste:');
    expect(multilineCode).toContain('[[mindroom-paste:');
  });

  it('keeps indented markers literal without suppressing root tool calls elsewhere', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      [
        '    🔧 `example_tool` [1]',
        '',
        '- A list item',
        '    with continuation text',
        '',
        '🔧 `read_file` [2]',
      ].join('\n')
    );

    expect(formattedBody).not.toContain('<p>🔧 <code>example_tool</code> [1]</p>');
    expect(formattedBody).toContain('example_tool');
    expect(formattedBody).toContain('<p>🔧 <code>read_file</code> [2]</p>');
  });

  it('preserves safe blockquotes, unordered dash lists, and display-math dashes', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['> Safe <unsafe> and **quoted**', '', '- alpha', '-  beta'].join('\n')
    );
    const mathBody = formatMindroomMarkdownTextBodyAsHtml(['$$', '- a + b', '$$'].join('\n'));

    expect(formattedBody).toContain('<blockquote data-md=">">');
    expect(formattedBody).toContain('&lt;unsafe&gt;');
    expect(formattedBody).toContain('<strong data-md="**">quoted</strong>');
    expect(formattedBody).toContain('<ul data-md="*">');
    expect(formattedBody).not.toContain('<ol');
    expect(mathBody).toContain('data-mx-maths="- a + b"');
  });

  it('preserves inline Markdown in ordinary wrench list prose', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      [
        '- prose 🔧 ordinary **bold** text',
        '- 🔧 ordinary **strong** text',
        '- 🔧 `tool` [0] **invalid** marker',
        '- 🔧 `tool<name` [1] **entity** marker',
      ].join('\n')
    );

    expect(formattedBody).toContain('<strong data-md="**">bold</strong>');
    expect(formattedBody).toContain('<strong data-md="**">strong</strong>');
    expect(formattedBody).toContain('<strong data-md="**">invalid</strong>');
    expect(formattedBody).toContain('<strong data-md="**">entity</strong>');
  });

  it('sanitizes display math exactly once', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['$$', String.raw`\begin{aligned}a & b\end{aligned}`, '$$'].join('\n')
    );

    expect(formattedBody).toContain(
      String.raw`data-mx-maths="\begin{aligned}a &amp; b\end{aligned}"`
    );
    expect(formattedBody).not.toContain('&amp;amp;');
  });

  it('sanitizes inline math exactly once', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      String.raw`When $a < b & c$, continue.`
    );

    expect(formattedBody).toContain(
      String.raw`<span data-mx-maths="a &lt; b &amp; c">a &lt; b &amp; c</span>`
    );
    expect(formattedBody).not.toContain('&amp;lt;');
    expect(formattedBody).not.toContain('&amp;amp;');
  });

  it('keeps dash lists unordered when later text contains inline code', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['- first', '- second', '', 'Use `x`'].join('\n')
    );

    expect(formattedBody).toContain('<ul data-md="*">');
    expect(formattedBody).not.toContain('<ol');
    expect(formattedBody).toContain('<code data-md="`">x</code>');
  });

  it('keeps root dash lists unordered with wide marker spacing', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['-     first', '-     second'].join('\n')
    );

    expect(formattedBody).toContain('<ul data-md="*">');
    expect(formattedBody).not.toContain('<ol');
  });

  it('keeps nested dash lists unordered', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['- parent', '    - child'].join('\n')
    );

    expect(formattedBody.match(/<ul data-md="\*">/g)).toHaveLength(2);
    expect(formattedBody).not.toContain('<ol');
  });

  it('leaves tab-indented dash text literal', () => {
    expect(formatMindroomMarkdownTextBodyAsHtml('\t- item')).toBe('\t- item');
  });

  it('keeps parser-accepted dash items unordered when content starts with whitespace', () => {
    ['-  ', '- \titem'].forEach((body) => {
      const formattedBody = formatMindroomMarkdownTextBodyAsHtml(body);

      expect(formattedBody).toContain('<ul data-md="*">');
      expect(formattedBody).not.toContain('<ol');
    });
  });

  it('falls back before recursive block or inline input reaches the parser', () => {
    const blockHeavy = Array.from({ length: 4_000 }, (_, index) => `# heading ${index}`).join('\n');
    const inlineHeavy = String.raw`\*`.repeat(513);

    expect(() => formatMindroomMarkdownTextBodyAsHtml(blockHeavy)).not.toThrow();
    expect(formatMindroomMarkdownTextBodyAsHtml(blockHeavy)).toBe('');
    expect(formatMindroomMarkdownTextBodyAsHtml(inlineHeavy)).toBe('');
  });

  it('does not count standalone tool markers against the parser budget', () => {
    const markers = Array.from(
      { length: 120 },
      (_, index) => `🔧 \`matrix_matrix_read_room_recent\` [${index + 1}]`
    );
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      [...markers, '', 'Done: **sent**.'].join('\n\n')
    );

    expect(
      formattedBody.match(/<p>🔧 <code>matrix_matrix_read_room_recent<\/code> \[\d+\]<\/p>/g)
    ).toHaveLength(120);
    expect(formattedBody).toContain('<strong data-md="**">sent</strong>');
    // An ambiguous `` line sends the markers through the parser, so they count again.
    expect(formatMindroomMarkdownTextBodyAsHtml([...markers, 'a `` b'].join('\n\n'))).toBe('');
  });
});
