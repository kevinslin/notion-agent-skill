const {
  resolveRelationIds,
  buildRelationPropertyValue,
} = require('../commands/sync');

describe('sync relation helpers', () => {
  const databaseId = 'db-1234';
  const schemaCache = new Map([
    [databaseId, { propNameToType: {}, titlePropName: 'Name', relationDatabaseIdByProp: {} }],
  ]);

  test('creates missing relation targets when allowed', async () => {
    const client = {
      databases: {
        query: jest.fn().mockResolvedValue({ results: [] }),
      },
      pages: {
        create: jest.fn().mockResolvedValue({ id: 'new-page-id' }),
      },
    };

    const ids = await resolveRelationIds({
      client,
      schemaCache,
      relationCache: new Map(),
      databaseId,
      relationNames: ['Project Alpha'],
      errorIfNotFound: false,
      allowCreate: true,
    });

    expect(ids).toEqual(['new-page-id']);
    expect(client.pages.create).toHaveBeenCalledTimes(1);
    const createArgs = client.pages.create.mock.calls[0][0];
    expect(createArgs.parent).toEqual({ database_id: databaseId });
    expect(createArgs.properties.Name.title[0].text.content).toBe('Project Alpha');
  });

  test('returns existing relation target when found', async () => {
    const client = {
      databases: {
        query: jest.fn().mockResolvedValue({ results: [{ id: 'existing-id' }] }),
      },
      pages: {
        create: jest.fn(),
      },
    };

    const ids = await resolveRelationIds({
      client,
      schemaCache,
      relationCache: new Map(),
      databaseId,
      relationNames: ['Project Beta'],
      errorIfNotFound: false,
      allowCreate: true,
    });

    expect(ids).toEqual(['existing-id']);
    expect(client.pages.create).not.toHaveBeenCalled();
  });

  test('throws if multiple relation targets are found', async () => {
    const client = {
      databases: {
        query: jest.fn().mockResolvedValue({ results: [{ id: 'one' }, { id: 'two' }] }),
      },
      pages: {
        create: jest.fn(),
      },
    };

    await expect(
      resolveRelationIds({
        client,
        schemaCache,
        relationCache: new Map(),
        databaseId,
        relationNames: ['Project Gamma'],
        errorIfNotFound: false,
        allowCreate: true,
      })
    ).rejects.toThrow(/Multiple relation pages/);
  });

  test('buildRelationPropertyValue merges on append', () => {
    const propertyValue = buildRelationPropertyValue({
      ids: ['a', 'b'],
      mode: 'append',
      existingProperty: { relation: [{ id: 'b' }, { id: 'c' }] },
    });

    expect(propertyValue.relation.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });
});
