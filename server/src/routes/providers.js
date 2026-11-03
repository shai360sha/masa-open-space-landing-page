import { Router } from 'express';
import { allowRoles } from '../auth.js';
import { logActivity } from '../activity.js';
import pool from '../db.js';
import { decryptSecret, encryptSecret } from '../security.js';
import { asyncRoute, HttpError, parseId } from '../http.js';

const router = Router();
router.use(allowRoles('admin'));

const providerSelect = `
  SELECT id, name, provider_type AS providerType, model, base_url AS baseUrl,
         prompt_template AS promptTemplate, extra_config AS extraConfig,
         is_default AS isDefault, is_active AS isActive
  FROM ai_providers
`;
const defaultPrompt = `Write a short, engaging story for {{studentName}} in {{language}}.
The learner's proficiency level is {{proficiencyLevel}}.
Naturally include these learned words: {{learnedWords}}.
Use age-appropriate language. Return only valid JSON with "title" and "content" string fields.`;

export class AiProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiProviderError';
  }
}

router.get('/', asyncRoute(async (_request, response) => {
  const [providers] = await pool.query(
    `${providerSelect.replace('SELECT id,', 'SELECT id, encrypted_api_key AS encryptedApiKey,')} ORDER BY is_default DESC, name`,
  );
  response.json({
    providers: providers.map((provider) => ({
      ...provider,
      hasApiKey: Boolean(provider.encryptedApiKey),
      extraConfig: parseExtraConfig(provider.extraConfig),
      encryptedApiKey: undefined,
    })),
  });
}));

router.post('/', asyncRoute(async (request, response) => {
  const input = validateProvider(request.body, { creating: true });
  const encryptedApiKey = encryptSecret(input.apiKey);
  const extraConfig = JSON.stringify(input.extraConfig);
  const connection = await pool.getConnection();
  let providerId;

  try {
    await connection.beginTransaction();
    if (input.isDefault) {
      await connection.query('UPDATE ai_providers SET is_default = FALSE');
    }
    const [result] = await connection.query(
      `INSERT INTO ai_providers
       (name, provider_type, model, base_url, encrypted_api_key, prompt_template, extra_config, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.name, input.providerType, input.model, input.baseUrl,
        encryptedApiKey, input.promptTemplate, extraConfig, input.isDefault, input.isActive,
      ],
    );
    providerId = result.insertId;
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await logActivity(request.user.id, 'ai-provider.created', 'ai_provider', providerId);
  response.status(201).json({ provider: await getProvider(providerId) });
}));

router.put('/:id', asyncRoute(async (request, response) => {
  const providerId = parseId(request.params.id);
  const [existingRows] = await pool.query(
    `${providerSelect} WHERE id = ?`,
    [providerId],
  );
  if (!existingRows[0]) {
    throw new HttpError(404, 'ספק ה־AI לא נמצא.');
  }

  const input = validateProvider(request.body);
  const fields = {
    name: ['name', input.name],
    providerType: ['provider_type', input.providerType],
    model: ['model', input.model],
    baseUrl: ['base_url', input.baseUrl],
    promptTemplate: ['prompt_template', input.promptTemplate],
    isActive: ['is_active', input.isActive],
    isDefault: ['is_default', input.isDefault],
  };
  const updates = Object.entries(fields)
    .filter(([key]) => input[key] !== undefined)
    .map(([, value]) => value);
  if (input.extraConfig !== undefined) {
    updates.push(['extra_config', JSON.stringify(input.extraConfig)]);
  }
  if (input.apiKey) {
    updates.push(['encrypted_api_key', encryptSecret(input.apiKey)]);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (input.isDefault === true) {
      await connection.query('UPDATE ai_providers SET is_default = FALSE');
    }
    if (updates.length) {
      await connection.query(
        `UPDATE ai_providers SET ${updates.map(([column]) => `\`${column}\` = ?`).join(', ')} WHERE id = ?`,
        [...updates.map(([, value]) => value), providerId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await logActivity(request.user.id, 'ai-provider.updated', 'ai_provider', providerId);
  response.json({ provider: await getProvider(providerId) });
}));

router.post('/:id/test', asyncRoute(async (request, response) => {
  const providerId = parseId(request.params.id);
  const [providers] = await pool.query(
    `SELECT model, base_url AS baseUrl, encrypted_api_key AS encryptedApiKey,
            extra_config AS extraConfig FROM ai_providers WHERE id = ?`,
    [providerId],
  );
  const provider = providers[0];
  if (!provider) {
    throw new HttpError(404, 'ספק ה־AI לא נמצא.');
  }

  let result;
  try {
    result = await fetchChatCompletion(provider, [
      { role: 'user', content: 'Reply with the single word OK.' },
    ], 20);
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw new HttpError(502, error.message);
    }
    throw error;
  }
  response.json({ success: Boolean(result) });
}));

async function getProvider(providerId) {
  const [providers] = await pool.query(`${providerSelect} WHERE id = ?`, [providerId]);
  return {
    ...providers[0],
    hasApiKey: true,
    extraConfig: parseExtraConfig(providers[0].extraConfig),
  };
}

export function validateProvider(body, { creating = false } = {}) {
  const result = {};
  const required = ['name', 'providerType', 'model', 'baseUrl', 'promptTemplate'];
  for (const field of required) {
    const value = body[field];
    if (value !== undefined || creating) {
      if (typeof value !== 'string' || !value.trim() || value.length > (field === 'promptTemplate' ? 10000 : 2048)) {
        throw new HttpError(400, `הגדרת ${field} אינה תקינה.`);
      }
      result[field] = value.trim();
    }
  }

  if (body.apiKey !== undefined || creating) {
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 4096) {
      throw new HttpError(400, 'יש להזין מפתח API תקין.');
    }
    result.apiKey = body.apiKey.trim();
  }
  for (const field of ['isActive', 'isDefault']) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'boolean') {
        throw new HttpError(400, `הגדרת ${field} אינה תקינה.`);
      }
      result[field] = body[field];
    }
  }
  if (body.extraConfig !== undefined) {
    if (!body.extraConfig || typeof body.extraConfig !== 'object' || Array.isArray(body.extraConfig)) {
      throw new HttpError(400, 'ההגדרות הנוספות חייבות להיות אובייקט JSON.');
    }
    result.extraConfig = body.extraConfig;
  } else if (creating) {
    result.extraConfig = {};
  }

  if (result.baseUrl !== undefined) {
    let url;
    try {
      url = new URL(result.baseUrl);
    } catch {
      throw new HttpError(400, 'כתובת ה־API אינה תקינה.');
    }
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:'))
      || url.username || url.password || url.search || url.hash
    ) {
      throw new HttpError(400, 'כתובת ספק ה־API חייבת להשתמש ב־HTTPS (למעט שרת פיתוח מקומי).');
    }
  }
  if (result.extraConfig) {
    if (
      result.extraConfig.temperature !== undefined
      && (typeof result.extraConfig.temperature !== 'number' || result.extraConfig.temperature < 0 || result.extraConfig.temperature > 2)
    ) {
      throw new HttpError(400, 'הטמפרטורה חייבת להיות מספר בין 0 ל־2.');
    }
    if (
      result.extraConfig.maxTokens !== undefined
      && (!Number.isInteger(result.extraConfig.maxTokens) || result.extraConfig.maxTokens < 1 || result.extraConfig.maxTokens > 8192)
    ) {
      throw new HttpError(400, 'מספר הטוקנים חייב להיות מספר שלם בין 1 ל־8192.');
    }
  }
  return result;
}

export async function fetchChatCompletion(provider, messages, timeoutSeconds = 60) {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const config = parseExtraConfig(provider.extraConfig);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${decryptSecret(provider.encryptedApiKey)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: config.temperature ?? 0.7,
        ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new AiProviderError('החיבור לספק ה־AI חרג מזמן ההמתנה.');
    }
    if (error.name === 'TypeError' || error.name === 'AbortError') {
      throw new AiProviderError('החיבור לספק ה־AI נכשל. בדקו את כתובת ה־API ואת הגדרות הרשת.');
    }
    throw error;
  }

  if (!response.ok) {
    throw new AiProviderError(`ספק ה־AI החזיר שגיאת HTTP ${response.status}. בדקו את המודל ואת מפתח ה־API.`);
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AiProviderError('ספק ה־AI החזיר תשובה שאינה JSON תקין.');
    }
    throw error;
  }
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AiProviderError('ספק ה־AI לא החזיר תשובת צ׳אט תקינה.');
  }
  return content.trim();
}

function parseExtraConfig(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}

export { defaultPrompt };
export default router;
