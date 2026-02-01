module.exports = {
  fnameTrigger: 'task.*',
  fmToSync: [
    { name: 'title', target: 'Name' },
    { name: 'proj', target: 'Tags', mode: 'append' },
  ],
  destination: {
    databaseId: '6b4e3123-d894-453e-9572-a93ced03c9e6',
  },
};
