/**
 * The Express plumbing, re-exported from @saar/http.
 *
 * These used to be defined here and again, near-identically, in apps/cms-api.
 * The copies drifted — this one's error handler grew a message for an oversized
 * body that the CMS's never got — and one of them, sanitizeMongo, is a security
 * control, where drift means a fix applied to one server and no test able to
 * tell you which.
 *
 * The import site stays here on purpose: routes import from '../middleware',
 * and this file is where anything genuinely specific to the read API would go.
 */
export {
  requestId,
  sanitizeMongo,
  errorHandler,
  notFoundHandler,
  asyncRoute,
} from '@saar/http';
