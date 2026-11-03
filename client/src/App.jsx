import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const defaultPrompt = `Write a short, engaging story for {{studentName}} in {{language}}.
The learner's proficiency level is {{proficiencyLevel}}.
Naturally include these learned words: {{learnedWords}}.
Use age-appropriate language. Return only valid JSON with "title" and "content" string fields.`;

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'הבקשה נכשלה.');
  return result;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onLogin(user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark">ס</div>
        <span className="eyebrow">סיפורים אישיים ללימוד שפות</span>
        <h1>טוב לראות אותך</h1>
        <p>התחברו לאזור האישי כדי לנהל את התלמידים והסיפורים.</p>
        <label>
          כתובת אימייל
          <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          סיסמה
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button full-width" type="submit" disabled={busy}>
          {busy ? 'מתחברים...' : 'כניסה למערכת'}
        </button>
        <small>אין הרשמה ציבורית. פרטי הכניסה ניתנים על ידי מנהל המערכת.</small>
      </form>
    </main>
  );
}

function Metric({ label, value, icon }) {
  return (
    <article className="metric-card">
      <span className="metric-icon">{icon}</span>
      <span className="metric-label">{label}</span>
      <strong>{value ?? '—'}</strong>
    </article>
  );
}

function StudentForm({ student, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    name: student?.name || '',
    phone: student?.phone || '',
    language: student?.language || '',
    proficiencyLevel: student?.proficiencyLevel || '',
    timezone: student?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    storyTime: student?.storyTime || '',
    isActive: student?.isActive ?? true,
    wordsText: student?.words?.map((word) => word.translation ? `${word.word}=${word.translation}` : word.word).join('\n') || '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const editing = Boolean(student?.id);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const words = form.wordsText.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [word, ...translation] = line.split('=');
      return { word: word.trim(), translation: translation.join('=').trim() || null };
    });
    const body = {
      name: form.name,
      phone: form.phone || null,
      language: form.language,
      proficiencyLevel: form.proficiencyLevel,
      timezone: form.timezone,
      storyTime: form.storyTime || null,
      isActive: form.isActive,
      words,
    };
    try {
      await onSave(body);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form-panel" onSubmit={submit}>
      <div className="panel-heading">
        <div><h2>{editing ? 'עריכת תלמיד' : 'תלמיד חדש'}</h2><p>פרטי הלימוד ולוח הסיפורים של התלמיד.</p></div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="סגירה">×</button>
      </div>
      <div className="form-grid">
        <label>שם התלמיד<input value={form.name} onChange={(event) => update('name', event.target.value)} maxLength="150" required /></label>
        <label>מספר טלפון<input type="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)} maxLength="32" /></label>
        <label>שפה נלמדת<input value={form.language} onChange={(event) => update('language', event.target.value)} placeholder="למשל: אנגלית" required /></label>
        <label>רמה<input value={form.proficiencyLevel} onChange={(event) => update('proficiencyLevel', event.target.value)} placeholder="למשל: מתחילים" required /></label>
        <label>אזור זמן<input value={form.timezone} onChange={(event) => update('timezone', event.target.value)} placeholder="Asia/Jerusalem" required /></label>
        <label>שעת סיפור יומית<input type="time" value={form.storyTime} onChange={(event) => update('storyTime', event.target.value)} /></label>
      </div>
      <label>מילים שנלמדו <span className="label-hint">מילה בכל שורה; אפשר להוסיף תרגום אחרי סימן =</span>
        <textarea rows="5" value={form.wordsText} onChange={(event) => update('wordsText', event.target.value)} placeholder={'apple=תפוח\nschool=בית ספר'} />
      </label>
      {editing && <label className="checkbox-label"><input type="checkbox" checked={form.isActive} onChange={(event) => update('isActive', event.target.checked)} /> תלמיד פעיל</label>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="primary-button" disabled={busy}>{busy ? 'שומרים...' : 'שמירת תלמיד'}</button>
        <button className="secondary-button" type="button" onClick={onCancel}>ביטול</button>
      </div>
    </form>
  );
}

function StudentsPage({ notify }) {
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stories, setStories] = useState([]);
  const [readingStory, setReadingStory] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const result = await api('/students');
    setStudents(result.students);
  }, []);

  useEffect(() => {
    refresh().catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }, [refresh]);

  async function save(body) {
    if (showForm === 'edit' && selected) {
      await api(`/students/${selected.id}`, { method: 'PUT', body: JSON.stringify(body) });
      notify('פרטי התלמיד נשמרו.');
    } else {
      await api('/students', { method: 'POST', body: JSON.stringify(body) });
      notify('התלמיד נוסף בהצלחה.');
    }
    await refresh();
    setShowForm(false);
    setSelected(null);
  }

  async function openStudent(student) {
    try {
      const result = await api(`/students/${student.id}`);
      setSelected(result.student);
      setStories(result.student.stories || []);
      setShowForm(false);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function archiveStudent(student) {
    if (!window.confirm(`להעביר את ${student.name} לארכיון? הסיפורים הקודמים יישמרו.`)) return;
    try {
      await api(`/students/${student.id}`, { method: 'DELETE' });
      setSelected(null);
      await refresh();
      notify('התלמיד הועבר לארכיון.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function generateStory(student) {
    try {
      const result = await api(`/students/${student.id}/stories/generate`, { method: 'POST' });
      notify(result.status === 'succeeded' ? 'כבר נוצר סיפור במועד זה.' : 'הסיפור נוסף לתור היצירה.');
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  const visibleStudents = students.filter((student) => `${student.name} ${student.language}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">הכיתה שלך</span><h1>התלמידים שלי</h1><p>כל פרטי הלמידה והסיפורים במקום אחד.</p></div>
        <button className="primary-button" onClick={() => { setSelected(null); setShowForm('new'); }}>＋ תלמיד חדש</button>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {showForm && <StudentForm student={showForm === 'edit' ? selected : null} onSave={save} onCancel={() => setShowForm(false)} />}
      <div className="toolbar"><input aria-label="חיפוש תלמיד" placeholder="חיפוש לפי שם או שפה..." value={search} onChange={(event) => setSearch(event.target.value)} /><span>{students.length} תלמידים</span></div>
      {loading ? <div className="empty-state">טוענים את רשימת התלמידים...</div> : visibleStudents.length === 0 ? (
        <div className="empty-state"><span className="empty-icon">✳</span><h2>{search ? 'לא נמצאו תוצאות' : 'הכיתה שלך מתחילה כאן'}</h2><p>{search ? 'נסו לחפש לפי שם אחר או שפה.' : 'הוסיפו תלמיד כדי להתחיל לעקוב אחר הלמידה וליצור סיפורים אישיים.'}</p>{!search && <button className="primary-button" onClick={() => setShowForm('new')}>הוספת תלמיד ראשון</button>}</div>
      ) : (
        <div className="student-layout">
          <div className="student-list">
            {visibleStudents.map((student) => (
              <button className={`student-card ${selected?.id === student.id ? 'selected' : ''}`} key={student.id} onClick={() => openStudent(student)}>
                <span className="avatar">{student.name.slice(0, 1)}</span>
                <span className="student-card-info"><strong>{student.name}</strong><small>{student.language} · {student.proficiencyLevel}</small></span>
                <span className={`status-dot ${student.isActive ? 'active' : ''}`} title={student.isActive ? 'פעיל' : 'בארכיון'} />
              </button>
            ))}
          </div>
          <section className="panel student-detail">
            {selected ? (
              <>
                <div className="detail-heading">
                  <span className="avatar large">{selected.name.slice(0, 1)}</span>
                  <div><h2>{selected.name}</h2><p>{selected.language} · {selected.proficiencyLevel}</p></div>
                  <div className="detail-actions"><button className="secondary-button small-button" onClick={() => setShowForm('edit')}>עריכה</button><button className="secondary-button small-button" onClick={() => generateStory(selected)}>יצירת סיפור</button><button className="icon-button danger" onClick={() => archiveStudent(selected)} aria-label="העברת התלמיד לארכיון">⌫</button></div>
                </div>
                <div className="student-facts">
                  <div><small>טלפון</small><span>{selected.phone || 'לא הוזן'}</span></div>
                  <div><small>אזור זמן</small><span>{selected.timezone}</span></div>
                  <div><small>שעת סיפור</small><span>{selected.storyTime || 'לא נקבעה'}</span></div>
                  <div><small>מצב</small><span>{selected.isActive ? 'פעיל' : 'בארכיון'}</span></div>
                </div>
                <div className="detail-section"><div className="section-title"><h3>מילים שנלמדו</h3><span>{selected.words?.length || 0}</span></div><div className="word-list">{selected.words?.length ? selected.words.map((word) => <span className="word-chip" key={word.id}>{word.word}{word.translation && <small>{word.translation}</small>}</span>) : <p className="muted">עדיין לא נוספו מילים.</p>}</div></div>
                <div className="detail-section"><div className="section-title"><h3>סיפורים אחרונים</h3><span>{stories.length}</span></div>{stories.length ? <div className="story-list">{stories.slice(0, 8).map((story) => <article className="story-row" key={story.id}><div><strong>{story.title}</strong><small>{formatDate(story.createdAt)}</small></div><button className="text-button" onClick={() => setReadingStory(story)}>קריאה</button></article>)}</div> : <p className="muted">הסיפורים שייווצרו יופיעו כאן.</p>}</div>
              </>
            ) : <div className="detail-placeholder"><span>←</span><h2>בחרו תלמיד מהרשימה</h2><p>כרטיס התלמיד כולל את פרטי הלמידה והסיפורים שנוצרו.</p></div>}
          </section>
        </div>
      )}
      {readingStory && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setReadingStory(null); }}><article className="panel story-modal"><button className="icon-button modal-close" onClick={() => setReadingStory(null)} aria-label="סגירה">×</button><span className="eyebrow">{selected?.name} · {readingStory.language}</span><h2>{readingStory.title}</h2><p className="story-full-content">{readingStory.content}</p></article></div>}
    </>
  );
}

function StoriesPage() {
  const [stories, setStories] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/stories').then((result) => setStories(result.stories)).catch((requestError) => setError(requestError.message));
  }, []);
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">ספריית הקריאה</span><h1>סיפורים שנוצרו</h1><p>כל הסיפורים שנוצרו עבור התלמידים שלך.</p></div></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {!stories.length ? <div className="empty-state"><span className="empty-icon">▤</span><h2>הסיפורים הראשונים בדרך</h2><p>כשתלמידים יקבלו סיפורים, הם יופיעו כאן.</p></div> : <div className="story-grid">{stories.map((story) => <article className="panel story-card" key={story.id}><div className="story-card-meta"><span>{story.studentName}</span><small>{formatDate(story.createdAt)}</small></div><h2>{story.title}</h2><p className="story-excerpt">{story.content}</p><div className="story-card-footer"><span>{story.language} · {story.proficiencyLevel}</span><button className="text-button" onClick={() => setSelected(story)}>לקריאת הסיפור</button></div></article>)}</div>}
      {selected && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><article className="panel story-modal"><button className="icon-button modal-close" onClick={() => setSelected(null)} aria-label="סגירה">×</button><span className="eyebrow">{selected.studentName} · {selected.language}</span><h2>{selected.title}</h2><p className="story-full-content">{selected.content}</p></article></div>}
    </>
  );
}

function TeachersPage({ notify }) {
  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => api('/admin/teachers').then((result) => setTeachers(result.teachers)), []);
  useEffect(() => { refresh().catch((requestError) => setError(requestError.message)); }, [refresh]);

  async function createTeacher(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/admin/teachers', { method: 'POST', body: JSON.stringify(form) });
      setForm({ fullName: '', email: '', password: '' });
      await refresh();
      notify('חשבון המורה נוצר.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(teacher) {
    try {
      await api(`/admin/teachers/${teacher.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !teacher.isActive }) });
      await refresh();
      notify(teacher.isActive ? 'חשבון המורה הושבת.' : 'חשבון המורה הופעל.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">ניהול מערכת</span><h1>המורים במערכת</h1><p>חשבונות, פעילות ומספר הסיפורים של כל מורה.</p></div></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <form className="panel teacher-create" onSubmit={createTeacher}><div><h2>הוספת מורה</h2><p>הגדירו פרטי כניסה ראשוניים; המורה יוכל להתחבר מיד.</p></div><div className="form-grid"><label>שם מלא<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label><label>אימייל<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label><label>סיסמה זמנית<input type="password" minLength="12" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label></div><button className="primary-button" disabled={busy}>{busy ? 'יוצרים...' : 'יצירת חשבון מורה'}</button></form>
      <section className="panel table-panel"><div className="panel-heading"><div><h2>רשימת מורים</h2><p>{teachers.length} חשבונות</p></div></div>{teachers.length ? <div className="table-scroll"><table><thead><tr><th>מורה</th><th>תלמידים</th><th>סיפורים</th><th>פעילות אחרונה</th><th>סטטוס</th><th>פעולה</th></tr></thead><tbody>{teachers.map((teacher) => <tr key={teacher.id}><td><strong>{teacher.fullName}</strong><small>{teacher.email}</small></td><td>{teacher.studentCount}</td><td>{teacher.storyCount}</td><td>{formatDate(teacher.lastActiveAt)}</td><td><span className={`table-status ${teacher.isActive ? 'enabled' : 'disabled'}`}>{teacher.isActive ? 'פעיל' : 'מושבת'}</span></td><td><button className="text-button" onClick={() => toggleActive(teacher)}>{teacher.isActive ? 'השבתה' : 'הפעלה'}</button></td></tr>)}</tbody></table></div> : <p className="muted table-empty">עדיין לא נוצרו חשבונות מורים.</p>}</section>
    </>
  );
}

function ProvidersPage({ notify }) {
  const [providers, setProviders] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const blankProvider = { name: '', providerType: 'openai-compatible', model: '', baseUrl: 'https://api.openai.com/v1', apiKey: '', promptTemplate: defaultPrompt, extraConfig: {}, isDefault: false, isActive: true };
  const [form, setForm] = useState(blankProvider);
  const [extraConfigText, setExtraConfigText] = useState('{}');
  const refresh = useCallback(() => api('/admin/ai-providers').then((result) => setProviders(result.providers)), []);
  useEffect(() => { refresh().catch((requestError) => setError(requestError.message)); }, [refresh]);

  function editProvider(provider) {
    setEditing(provider.id);
    setForm({ ...provider, apiKey: '' });
    setExtraConfigText(JSON.stringify(provider.extraConfig || {}, null, 2));
  }

  function resetForm() {
    setEditing(null);
    setForm(blankProvider);
    setExtraConfigText('{}');
  }

  async function saveProvider(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      let extraConfig;
      try {
        extraConfig = JSON.parse(extraConfigText);
        if (!extraConfig || typeof extraConfig !== 'object' || Array.isArray(extraConfig)) {
          throw new Error('ההגדרות הנוספות חייבות להיות אובייקט JSON.');
        }
      } catch (requestError) {
        setError(requestError.message === 'Unexpected end of JSON input' ? 'ההגדרות הנוספות חייבות להיות JSON תקין.' : requestError.message);
        setBusy(false);
        return;
      }
      const body = { ...form, extraConfig };
      if (editing && !body.apiKey) delete body.apiKey;
      await api(editing ? `/admin/ai-providers/${editing}` : '/admin/ai-providers', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      resetForm();
      await refresh();
      notify('הגדרות ספק ה־AI נשמרו.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function testProvider(provider) {
    setError('');
    try {
      await api(`/admin/ai-providers/${provider.id}/test`, { method: 'POST', body: '{}' });
      notify('החיבור לספק ה־AI תקין.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">הגדרות מערכת</span><h1>ספקי AI</h1><p>הגדירו מודלים, מפתחות ופרומפטים ליצירת הסיפורים.</p></div></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <form className="panel form-panel" onSubmit={saveProvider}><div className="panel-heading"><div><h2>{editing ? 'עריכת ספק' : 'הוספת ספק AI'}</h2><p>המפתחות מוצפנים בשרת ואינם מוצגים מחדש.</p></div>{editing && <button className="secondary-button small-button" type="button" onClick={resetForm}>ביטול עריכה</button>}</div><div className="form-grid"><label>שם לתצוגה<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>מודל<input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="למשל: gpt-4o-mini" required /></label><label>סוג ספק<input value={form.providerType} onChange={(event) => setForm({ ...form, providerType: event.target.value })} required /></label><label>כתובת API<input type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} required /></label><label className="span-two">{editing ? 'מפתח API חדש (השאירו ריק ללא שינוי)' : 'מפתח API'}<input type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} required={!editing} /></label></div><label>תבנית פרומפט<textarea rows="7" value={form.promptTemplate} onChange={(event) => setForm({ ...form, promptTemplate: event.target.value })} required /></label><p className="label-hint">משתנים זמינים: {'{{studentName}}'}, {'{{language}}'}, {'{{proficiencyLevel}}'}, {'{{learnedWords}}'}</p><label>הגדרות נוספות (JSON)<textarea rows="3" value={extraConfigText} onChange={(event) => setExtraConfigText(event.target.value)} placeholder={'{"temperature":0.7,"maxTokens":1200}'} /></label><p className="label-hint">אפשר להגדיר temperature בין 0 ל־2 ו־maxTokens בין 1 ל־8192.</p><div className="form-actions"><label className="checkbox-label"><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} /> ספק ברירת מחדל</label><label className="checkbox-label"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> פעיל</label><button className="primary-button" disabled={busy}>{busy ? 'שומרים...' : 'שמירת הגדרות'}</button></div></form>
      <div className="provider-list">{providers.map((provider) => <article className="panel provider-card" key={provider.id}><div className="provider-heading"><span className="provider-icon">✳</span><div><h2>{provider.name}</h2><p>{provider.model} · {provider.providerType}</p></div>{provider.isDefault && <span className="table-status enabled">ברירת מחדל</span>}</div><div className="provider-meta"><span>{provider.hasApiKey ? 'מפתח API מוגדר ומוצפן' : 'חסר מפתח API'}</span><span className={`table-status ${provider.isActive ? 'enabled' : 'disabled'}`}>{provider.isActive ? 'פעיל' : 'מושבת'}</span></div><div className="form-actions"><button className="secondary-button small-button" onClick={() => editProvider(provider)}>עריכה</button><button className="secondary-button small-button" onClick={() => testProvider(provider)}>בדיקת חיבור</button></div></article>)}</div>
    </>
  );
}

function ActivityPage() {
  const [activities, setActivities] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { api('/admin/activity').then((result) => setActivities(result.activities)).catch((requestError) => setError(requestError.message)); }, []);
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">מעקב מערכת</span><h1>פעילות אחרונה</h1><p>עדכונים על חשבונות, תלמידים ויצירת סיפורים.</p></div></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <section className="panel activity-list">{activities.length ? activities.map((activity) => <article className="activity-row" key={activity.id}><span className="activity-dot" /><div><strong>{activityAction(activity.action)}</strong><small>{activity.actorName || 'משימה אוטומטית'} · {formatDate(activity.createdAt)}</small></div></article>) : <div className="empty-state"><p>עדיין לא נרשמה פעילות במערכת.</p></div>}</section>
    </>
  );
}

function activityAction(action) {
  const actions = {
    'student.created': 'תלמיד חדש נוסף',
    'student.updated': 'פרטי תלמיד עודכנו',
    'student.archived': 'תלמיד הועבר לארכיון',
    'teacher.created': 'חשבון מורה נוצר',
    'teacher.updated': 'חשבון מורה עודכן',
    'ai-provider.created': 'ספק AI נוסף',
    'ai-provider.updated': 'הגדרות ספק AI עודכנו',
    'story.generated': 'סיפור חדש נוצר',
    'story.generation_failed': 'יצירת סיפור נכשלה',
  };
  return actions[action] || action;
}

function AdminHome({ overview }) {
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">סקירה כללית</span><h1>לוח הבקרה</h1><p>תמונת מצב של המורים, התלמידים והסיפורים.</p></div></div>
      {overview ? <div className="metrics-grid"><Metric label="מורים פעילים" value={`${overview.activeTeachers} / ${overview.totalTeachers}`} icon="♙" /><Metric label="תלמידים" value={overview.totalStudents} icon="◉" /><Metric label="סיפורים שנוצרו" value={overview.totalStories} icon="▤" /><Metric label="משימות שנכשלו" value={overview.failedJobs} icon="!" /></div> : <div className="empty-state">טוענים נתוני מערכת...</div>}
      <div className="panel dashboard-note"><div className="provider-icon">✳</div><div><h2>השלב הבא: הגדרת מודל AI</h2><p>הוסיפו ספק AI והגדירו אותו כברירת מחדל, כדי להתחיל ליצור סיפורים אישיים.</p></div></div>
    </>
  );
}

function TeacherHome({ user, notify }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/students/overview').then((result) => setOverview(result.overview)).catch((requestError) => setError(requestError.message));
  }, []);
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">שלום, {user.fullName}</span><h1>הכיתה שלך</h1><p>עקבו אחר ההתקדמות וצפו בסיפורים של התלמידים.</p></div></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="metrics-grid"><Metric label="תלמידים" value={overview?.totalStudents} icon="♙" /><Metric label="תלמידים פעילים" value={overview?.activeStudents} icon="◉" /><Metric label="סיפורים שנוצרו" value={overview?.totalStories} icon="▤" /></div>
      <div className="panel dashboard-note"><div className="provider-icon">✦</div><div><h2>סיפור חדש לכל תלמיד</h2><p>הוסיפו תלמיד, הגדירו את הרמה והמילים שלו, וקבעו שעה לקבלת סיפור יומי.</p></div><button className="primary-button" onClick={() => notify('בחרו "התלמידים שלי" בתפריט כדי להוסיף תלמיד.')}>איך מתחילים?</button></div>
    </>
  );
}

const teacherNavigation = [
  { id: 'home', label: 'סקירה כללית', icon: '⌂' },
  { id: 'students', label: 'התלמידים שלי', icon: '♙' },
  { id: 'stories', label: 'ספריית הסיפורים', icon: '▤' },
];
const adminNavigation = [
  { id: 'home', label: 'סקירה כללית', icon: '⌂' },
  { id: 'teachers', label: 'ניהול מורים', icon: '♙' },
  { id: 'providers', label: 'הגדרות AI', icon: '✳' },
  { id: 'stories', label: 'סיפורים במערכת', icon: '▤' },
  { id: 'activity', label: 'יומן פעילות', icon: '◷' },
];

function Dashboard({ user, onLogout }) {
  const [page, setPage] = useState('home');
  const [overview, setOverview] = useState(null);
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef(null);
  const isAdmin = user.role === 'admin';
  const navigation = isAdmin ? adminNavigation : teacherNavigation;
  const notify = useCallback((message) => {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 3500);
  }, []);

  useEffect(() => {
    if (isAdmin) api('/admin/overview').then((result) => setOverview(result.overview)).catch((error) => notify(error.message));
  }, [isAdmin, page, notify]);

  const pageTitle = useMemo(() => navigation.find((item) => item.id === page)?.label || '', [navigation, page]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('home'); }}><span className="brand-mark small">ס</span><span><strong>סיפורון</strong><small>לומדים דרך סיפורים</small></span></a>
        <div className="workspace-label">{isAdmin ? 'ניהול מערכת' : 'אזור המורה'}</div>
        <nav className="main-nav" aria-label="ניווט ראשי">{navigation.map((item) => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-bottom"><div className="user-card"><span className="avatar">{user.fullName.slice(0, 1)}</span><div><strong>{user.fullName}</strong><small>{isAdmin ? 'מנהל מערכת' : 'מורה'}</small></div></div><button className="logout-button" onClick={() => onLogout().catch((error) => notify(error.message))}>↪ יציאה</button></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><span className="breadcrumb">סיפורון <span>/</span> {pageTitle}</span><div><span className="welcome-user">שלום, {user.fullName}</span><span className="online-indicator"><i /> מחובר</span></div></header>
        <section className="content-area">
          {page === 'home' && (isAdmin ? <AdminHome overview={overview} /> : <TeacherHome user={user} notify={notify} />)}
          {page === 'students' && !isAdmin && <StudentsPage notify={notify} />}
          {page === 'stories' && <StoriesPage />}
          {page === 'teachers' && isAdmin && <TeachersPage notify={notify} />}
          {page === 'providers' && isAdmin && <ProvidersPage notify={notify} />}
          {page === 'activity' && isAdmin && <ActivityPage />}
        </section>
      </main>
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    api('/auth/me').then((result) => setUser(result.user)).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
  }

  if (checking) return <div className="startup-screen"><div className="brand-mark">ס</div><span>טוענים את סביבת העבודה...</span></div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Dashboard user={user} onLogout={logout} />;
}
