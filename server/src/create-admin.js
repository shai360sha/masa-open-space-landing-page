import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { access, unlink, writeFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';
import pool from './db.js';
import { hashPassword } from './security.js';

const credentialFile = fileURLToPath(new URL('../../.initial-admin.txt', import.meta.url));

async function readHidden(prompt) {
  if (!stdin.isTTY) {
    throw new Error('Create the initial admin from an interactive terminal.');
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    function finish(error) {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    }
    function onData(character) {
      if (character === '\u0003') return finish(new Error('Cancelled.'));
      if (character === '\r' || character === '\n') return finish();
      if (character === '\u007f' || character === '\b') {
        value = Array.from(value).slice(0, -1).join('');
        return;
      }
      if (character >= ' ') value += character;
    }
    stdin.on('data', onData);
  });
}

async function main() {
  const generated = process.argv.includes('--generate');
  const prompts = generated ? null : createInterface({ input: stdin, output: stdout });
  let credentialFileCreated = false;

  try {
    await runMigrations();
    const [admins] = await pool.query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    if (Number(admins[0].count) > 0) {
      throw new Error('An admin already exists. Use the admin interface to manage accounts.');
    }

    const fullName = generated ? 'מנהל מערכת' : (await prompts.question('שם מנהל המערכת: ')).trim();
    const email = generated
      ? 'admin@ai-story-teachers.local'
      : (await prompts.question('כתובת אימייל: ')).trim().toLowerCase();
    prompts?.close();
    if (!fullName || fullName.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('השם או כתובת האימייל אינם תקינים.');
    }

    let password;
    if (generated) {
      password = randomBytes(32).toString('base64url');
      try {
        await access(credentialFile);
        throw new Error('The local admin credentials file already exists; refusing to overwrite it.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await writeFile(
        credentialFile,
        `כתובת אימייל: ${email}\nסיסמה: ${password}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      credentialFileCreated = true;
    } else {
      password = await readHidden('סיסמה (לפחות 12 תווים): ');
      const confirmation = await readHidden('אישור סיסמה: ');
      if (password !== confirmation) {
        throw new Error('הסיסמאות אינן תואמות.');
      }
    }

    const passwordHash = await hashPassword(password);
    await pool.query(
      "INSERT INTO users (role, full_name, email, password_hash) VALUES ('admin', ?, ?, ?)",
      [fullName, email, passwordHash],
    );
    credentialFileCreated = false;
    console.log(generated
      ? 'נוצר חשבון אדמין. פרטי הכניסה שמורים בקובץ המקומי .initial-admin.txt.'
      : 'חשבון מנהל נוצר. ניתן להתחבר דרך ממשק האתר.');
  } finally {
    prompts?.close();
    if (credentialFileCreated) {
      await unlink(credentialFile).catch((error) => console.error('Failed to remove the unused local credentials file:', error));
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error('יצירת מנהל נכשלה:', error.message);
  process.exitCode = 1;
});
