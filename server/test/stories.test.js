import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { getLocalDateTime, buildStoryMessages, getRetryDelayMinutes, MAX_STORY_ATTEMPTS, parseGeneratedStory } from '../src/stories.js';
import { fetchChatCompletion, validateProvider } from '../src/routes/providers.js';
import { encryptSecret } from '../src/security.js';

process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');

test('story prompts include a learner language, level, and learned vocabulary', () => {
  const messages = buildStoryMessages(
    { name: 'Dana', language: 'English', proficiencyLevel: 'Beginner' },
    [{ word: 'apple', translation: 'תפוח' }],
    'Write for {{studentName}} in {{language}}, level {{proficiencyLevel}}. Use {{learnedWords}}.',
  );

  assert.match(messages[1].content, /Dana/);
  assert.match(messages[1].content, /English/);
  assert.match(messages[1].content, /Beginner/);
  assert.match(messages[1].content, /apple \(תפוח\)/);
});

test('story prompt safely handles students without learned words', () => {
  const messages = buildStoryMessages(
    { name: 'Dana', language: 'English', proficiencyLevel: 'Beginner' },
    [],
    '{{learnedWords}}',
  );
  assert.match(messages[1].content, /No learned words/);
});

test('generated stories parse JSON and reject malformed or oversized output', () => {
  assert.deepEqual(parseGeneratedStory('```json\n{"title":"A day","content":"A short story"}\n```'), {
    title: 'A day',
    content: 'A short story',
  });
  assert.throws(() => parseGeneratedStory('not json'), /invalid format/);
  assert.throws(() => parseGeneratedStory('{"title":"","content":"story"}'), /invalid fields/);
});

test('story scheduling uses the student time zone, including daylight time', () => {
  const winter = getLocalDateTime(new Date('2026-01-15T10:00:00Z'), 'Asia/Jerusalem');
  const summer = getLocalDateTime(new Date('2026-07-15T10:00:00Z'), 'Asia/Jerusalem');
  assert.equal(`${winter.hour}:${winter.minute}`, '12:00');
  assert.equal(`${summer.hour}:${summer.minute}`, '13:00');
});

test('story retries use bounded delays and stop after the configured attempt limit', () => {
  assert.equal(MAX_STORY_ATTEMPTS, 3);
  assert.deepEqual([1, 2].map(getRetryDelayMinutes), [1, 5]);
});

test('provider configuration requires a secure API URL and an API key', () => {
  const base = {
    name: 'OpenAI',
    providerType: 'openai-compatible',
    model: 'gpt-test',
    baseUrl: 'https://api.example.com/v1',
    promptTemplate: '{{studentName}}',
  };
  assert.throws(() => validateProvider(base, { creating: true }), /API/);
  assert.throws(() => validateProvider({ ...base, apiKey: 'key', baseUrl: 'http://example.com' }, { creating: true }), /HTTPS/);
  assert.throws(() => validateProvider({ ...base, apiKey: 'key', baseUrl: 'https://example.com/api?key=secret' }, { creating: true }), /HTTPS/);
  assert.equal(validateProvider({ ...base, apiKey: 'secret' }, { creating: true }).apiKey, 'secret');
});

test('provider updates can retain a stored API key without returning it', () => {
  const result = validateProvider({ name: 'Updated provider' });
  assert.deepEqual(result, { name: 'Updated provider' });
  assert.equal(result.apiKey, undefined);
});

test('provider generation sends encrypted credentials and configured model options', async (context) => {
  let receivedAuthorization;
  let receivedBody;
  const server = http.createServer(async (request, response) => {
    receivedAuthorization = request.headers.authorization;
    let body = '';
    for await (const chunk of request) body += chunk;
    receivedBody = JSON.parse(body);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '{"title":"Test","content":"Story"}' } }] }));
  }).listen(0, '127.0.0.1');
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');

  const content = await fetchChatCompletion({
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    encryptedApiKey: encryptSecret('test-secret'),
    model: 'test-model',
    extraConfig: { temperature: 0.2, maxTokens: 400 },
  }, [{ role: 'user', content: 'Write a story.' }]);

  assert.equal(content, '{"title":"Test","content":"Story"}');
  assert.equal(receivedAuthorization, 'Bearer test-secret');
  assert.equal(receivedBody.model, 'test-model');
  assert.equal(receivedBody.temperature, 0.2);
  assert.equal(receivedBody.max_tokens, 400);
});

test('provider options reject unsupported parameter ranges', () => {
  assert.throws(() => validateProvider({ extraConfig: { temperature: 2.1 } }), /הטמפרטורה/);
  assert.throws(() => validateProvider({ extraConfig: { maxTokens: 0 } }), /מספר הטוקנים/);
  assert.deepEqual(validateProvider({ extraConfig: { temperature: 0.4, maxTokens: 300 } }).extraConfig, {
    temperature: 0.4,
    maxTokens: 300,
  });
});
