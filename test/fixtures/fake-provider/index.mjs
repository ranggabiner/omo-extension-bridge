export default function (pi) {
  if (typeof pi.registerProvider === 'function') {
    pi.registerProvider('omox-fixture', {
      name: 'Omox Fixture',
      baseUrl: 'https://localhost:9999',
      api: 'omox-fixture-api',
      models: [
        {
          id: 'fixture-model',
          name: 'Fixture Model',
          contextWindow: 128000,
          maxTokens: 4096,
          reasoning: false,
          input: ['text'],
        },
      ],
      streamSimple: async function* () {
        yield { type: 'text_delta', text: 'FIXTURE_RESPONSE_OK' };
      },
    });
  }
}
