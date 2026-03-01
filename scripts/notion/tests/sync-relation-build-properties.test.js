const mockResolveDatabaseId = jest.fn();

jest.mock('../commands/fetch', () => ({
  resolveDatabaseId: (...args) => mockResolveDatabaseId(...args),
}));

const { buildProperties } = require('../commands/sync');

describe('sync relation buildProperties', () => {
  const baseSchema = {
    propNameToType: {
      Project: 'relation',
      dendron_id: 'rich_text',
      last_synced: 'date',
    },
    titlePropName: 'Name',
    relationDatabaseIdByProp: {},
  };

  const baseFrontmatter = {
    id: 'task.project-alpha',
    proj: 'Project Alpha',
  };

  const lastSyncedIso = '2026-03-01T10:00:00.000Z';

  beforeEach(() => {
    mockResolveDatabaseId.mockReset();
  });

  test('resolves relation database by databaseName and creates missing relation target by default', async () => {
    mockResolveDatabaseId.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000111',
      title: 'Projects',
    });

    const client = {
      databases: {
        retrieve: jest.fn().mockResolvedValue({
          properties: {
            Name: { type: 'title' },
          },
        }),
        query: jest.fn().mockResolvedValue({ results: [] }),
      },
      pages: {
        create: jest.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000222',
        }),
      },
    };

    const properties = await buildProperties({
      client,
      rule: {
        fmToSync: [
          {
            name: 'proj',
            target: 'Project',
            type: 'relation',
            databaseName: 'Projects',
          },
        ],
      },
      frontmatter: baseFrontmatter,
      schema: baseSchema,
      lastSyncedIso,
      existingProperties: null,
      schemaCache: new Map(),
      databaseIdCache: new Map(),
      relationCache: new Map(),
      env: 'test',
      dryRun: false,
    });

    expect(mockResolveDatabaseId).toHaveBeenCalledTimes(1);
    expect(mockResolveDatabaseId).toHaveBeenCalledWith({
      client,
      databaseId: null,
      databaseName: 'Projects',
      env: 'test',
    });
    expect(client.databases.query).toHaveBeenCalledWith({
      database_id: '00000000-0000-0000-0000-000000000111',
      filter: {
        property: 'Name',
        title: { equals: 'Project Alpha' },
      },
      page_size: 2,
    });
    expect(client.pages.create).toHaveBeenCalledTimes(1);
    expect(properties.Project).toEqual({
      relation: [{ id: '00000000-0000-0000-0000-000000000222' }],
    });
  });

  test('throws when relation target is missing and errorIfNotFound is true', async () => {
    mockResolveDatabaseId.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000111',
      title: 'Projects',
    });

    const client = {
      databases: {
        retrieve: jest.fn().mockResolvedValue({
          properties: {
            Name: { type: 'title' },
          },
        }),
        query: jest.fn().mockResolvedValue({ results: [] }),
      },
      pages: {
        create: jest.fn(),
      },
    };

    await expect(
      buildProperties({
        client,
        rule: {
          fmToSync: [
            {
              name: 'proj',
              target: 'Project',
              type: 'relation',
              databaseName: 'Projects',
              errorIfNotFound: true,
            },
          ],
        },
        frontmatter: baseFrontmatter,
        schema: baseSchema,
        lastSyncedIso,
        existingProperties: null,
        schemaCache: new Map(),
        databaseIdCache: new Map(),
        relationCache: new Map(),
        env: 'test',
        dryRun: false,
      })
    ).rejects.toThrow(
      'Relation target "Project Alpha" not found in database 00000000-0000-0000-0000-000000000111.'
    );

    expect(client.pages.create).not.toHaveBeenCalled();
  });
});
