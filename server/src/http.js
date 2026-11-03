export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireFields(body, fields) {
  for (const field of fields) {
    if (typeof body[field] !== 'string' || body[field].trim() === '') {
      throw new HttpError(400, `השדה ${field} הוא שדה חובה.`);
    }
  }
}

export function parseId(value) {
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw new HttpError(400, 'מזהה לא תקין.');
  }
  return value;
}

export function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
