const { parseMarkdownSection } = require('../utils');

describe('parseMarkdownSection', () => {
  test('parses title, metadata, and body from markdown section', () => {
    const input = [
      '## Team meeting notes',
      '- time: 8:25',
      '- source: GMAIL',
      '',
      'We discussed the project timeline and agreed to meet again next week.',
      'The main action items were assigned to the team members.',
    ].join('\n');

    const result = parseMarkdownSection(input);

    expect(result.title).toBe('Team meeting notes');
    expect(result.properties).toEqual({
      time: '8:25',
      source: 'Gmail',
    });
    expect(result.body).toContain('We discussed the project timeline');
  });

  test('handles missing heading gracefully', () => {
    const input = [
      '- time: 9:00',
      '',
      'Body only text',
    ].join('\n');

    const result = parseMarkdownSection(input);

    expect(result.title).toBeNull();
    expect(result.properties).toEqual({});
    expect(result.body).toContain('Body only text');
  });

  test('returns empty structure for falsy input', () => {
    const result = parseMarkdownSection('');
    expect(result).toEqual({
      title: null,
      properties: {},
      body: '',
    });
  });
});

