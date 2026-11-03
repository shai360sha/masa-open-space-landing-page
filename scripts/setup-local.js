import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = new URL('../.env', import.meta.url);
const databaseDirectory = new URL('../database/', import.meta.url);
const sqlPath = new URL('../database/local-setup.sql', import.meta.url);

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function main() {
  const envExists = await exists(envPath);
  const sqlExists = await exists(sqlPath);
  const refreshSql = process.argv.includes('--refresh-sql');
  const rotatePassword = process.argv.includes('--rotate-password');
  if ((envExists || sqlExists) && !refreshSql) {
    throw new Error(
      'An existing local .env or SQL setup file was found. Back it up or remove it before generating new credentials.',
    );
  }

  let mysqlPassword;
  if (envExists) {
    if (!refreshSql || !sqlExists) {
      throw new Error('Refresh mode only updates an existing generated SQL file when .env and database/local-setup.sql are both present.');
    }
    const envContents = await readFile(envPath, 'utf8');
    const match = envContents.match(/^MYSQL_PASSWORD=(.+)$/m);
    if (!match?.[1]) {
      throw new Error('MYSQL_PASSWORD was not found in the local .env file.');
    }
    if (rotatePassword) {
      mysqlPassword = randomBytes(32).toString('base64url');
      const updatedEnv = envContents.replace(/^MYSQL_PASSWORD=.+$/m, `MYSQL_PASSWORD=${mysqlPassword}`);
      const temporaryEnvPath = new URL('../.env.rotate.tmp', import.meta.url);
      try {
        await writeFile(temporaryEnvPath, updatedEnv, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporaryEnvPath, envPath);
      } catch (error) {
        await unlink(temporaryEnvPath).catch((cleanupError) => {
          if (cleanupError.code !== 'ENOENT') console.error('Could not remove temporary environment file:', cleanupError);
        });
        throw error;
      }
    } else {
      mysqlPassword = match[1];
    }
  } else {
    if (sqlExists) {
      throw new Error('A SQL setup file exists without a local .env file. Inspect and back it up before continuing.');
    }

    mysqlPassword = randomBytes(32).toString('base64url');
    const sessionSecret = randomBytes(48).toString('base64url');
    const encryptionKey = randomBytes(32).toString('base64');

    const env = [
      'MYSQL_HOST=127.0.0.1',
      'MYSQL_PORT=3306',
      'MYSQL_DATABASE=ai_story_teachers',
      'MYSQL_USER=ai_story_app',
      `MYSQL_PASSWORD=${mysqlPassword}`,
      `SESSION_SECRET=${sessionSecret}`,
      `ENCRYPTION_KEY=${encryptionKey}`,
      'PORT=3001',
      'CLIENT_ORIGIN=http://localhost:5173',
      '',
    ].join('\n');
    await writeFile(envPath, env, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }

  const sql = [
    'CREATE DATABASE IF NOT EXISTS ai_story_teachers CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;',
    "CREATE USER IF NOT EXISTS 'ai_story_app'@'127.0.0.1';",
    "CREATE USER IF NOT EXISTS 'ai_story_app'@'localhost';",
    `ALTER USER 'ai_story_app'@'127.0.0.1' IDENTIFIED BY '${mysqlPassword}';`,
    `ALTER USER 'ai_story_app'@'localhost' IDENTIFIED BY '${mysqlPassword}';`,
    "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON ai_story_teachers.* TO 'ai_story_app'@'127.0.0.1';",
    "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON ai_story_teachers.* TO 'ai_story_app'@'localhost';",
    '',
  ].join('\n');

  await mkdir(databaseDirectory, { recursive: true });
  await writeFile(sqlPath, sql, { encoding: 'utf8', flag: refreshSql ? 'w' : 'wx', mode: 0o600 });

  console.log(rotatePassword ? 'עודכן הסקריפט המקומי עם סיסמה חדשה:' : refreshSql ? 'עודכן סקריפט SQL מקומי:' : 'נוצרו קובצי הגדרה מקומיים ומאובטחים:');
  console.log(`  ${fileURLToPath(envPath)}`);
  console.log(`  ${fileURLToPath(sqlPath)}`);
  console.log('פתחו את database/local-setup.sql ב־MySQL Workbench והריצו אותו.');
  console.log('ה־SQL המקומי תואם לסיסמה שנשמרה ב־.env; אין להעלות קבצים אלה ל־Git או לשתף אותם.');
}

main().catch((error) => {
  console.error('הגדרת הפרויקט נכשלה:', error.message);
  process.exitCode = 1;
});
