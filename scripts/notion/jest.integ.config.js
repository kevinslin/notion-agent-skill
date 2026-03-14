module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/integ'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(c|m)?(j|t)sx?$',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  verbose: true,
};
