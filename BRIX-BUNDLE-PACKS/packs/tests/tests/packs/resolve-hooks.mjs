// Module-resolution hook: lets plain Node import this app's extensionless
// relative specifiers (`./db.server`) the way Vite does.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier)) throw error;
    for (const suffix of ['.js', '.jsx', '/index.js']) {
      try { return await nextResolve(specifier + suffix, context); } catch { /* try next */ }
    }
    throw error;
  }
}
