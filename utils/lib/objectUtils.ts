export function gettersToObject<T>(obj: T): T {
  if (typeof obj !== 'object') return obj;

  const result = {} as any;
  for (const key of Object.keys(obj)) {
    if (typeof result[key] === 'object') {
      result[key] = gettersToObject(obj[key]);
    } else {
      result[key] = obj[key];
    }
  }
  return result;
}
