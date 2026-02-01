const {
  parseFrontmatter,
  serializeFrontmatter,
  matchFnameTrigger,
  parseMultiSelectValues,
  mergeMultiSelectValues,
} = require('../utils/sync');

describe('Sync utilities', () => {
  test('parses frontmatter and body', () => {
    const markdown = `---
id: 123
fname: task.2025.12.28.finalize-trip
list:
  - a
  - b
---

- finalize the plan
`;

    const parsed = parseFrontmatter(markdown);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data).toEqual({
      id: 123,
      fname: 'task.2025.12.28.finalize-trip',
      list: ['a', 'b'],
    });
    expect(parsed.body).toBe('- finalize the plan');

    const serialized = serializeFrontmatter(parsed.data, parsed.body);
    const reparsed = parseFrontmatter(serialized);
    expect(reparsed.data).toEqual(parsed.data);
    expect(reparsed.body).toBe(parsed.body);
  });

  test('matches fname triggers with wildcards', () => {
    expect(matchFnameTrigger('task.2025.12.28.finalize-trip', 'task.*')).toBe(true);
    expect(matchFnameTrigger('note.task', 'task.*')).toBe(false);
  });

  test('parses multi-select values and merges append mode', () => {
    expect(parseMultiSelectValues('a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(parseMultiSelectValues(['x', 'y'])).toEqual(['x', 'y']);

    const merged = mergeMultiSelectValues(['a', 'b'], ['b', 'c']);
    expect(merged).toEqual(['a', 'b', 'c']);
  });
});
