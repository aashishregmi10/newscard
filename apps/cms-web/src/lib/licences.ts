import type { ImageLicence } from '../api';

/**
 * The licences a photograph or a clip may be published under.
 *
 * There were two of these lists, in two components, with the same four values
 * and different labels — the video one had quietly dropped the hints. They are
 * the same question about the same legal position, so they are one list. If
 * video ever genuinely needs a different set, it should be a different constant
 * with a name that says so, not a divergent copy of this one.
 *
 * The order is deliberate: most common first, so the default lands near the top
 * of an open dropdown rather than in the middle of it.
 */

export interface LicenceOption {
  value: ImageLicence;
  label: string;
  hint: string;
}

export const LICENCES: readonly LicenceOption[] = [
  {
    value: 'publisher_licensed',
    label: 'Publisher licensed',
    hint: 'Supplied by the publisher under our agreement with them',
  },
  { value: 'agency', label: 'Agency', hint: 'Reuters, AFP, AP and the like' },
  { value: 'cc_by', label: 'Creative Commons BY', hint: 'Attribution required in the credit' },
  { value: 'own', label: 'Our own', hint: 'Shot by us' },
];

/**
 * A licence's display name.
 *
 * Falls back to the raw value rather than an empty string: a licence the server
 * knows about and this build does not is a deployment that is mid-rollout, and
 * showing 'wire_service' is far better than showing a story whose licence
 * appears blank — which reads as "no licence", which is the one state that
 * blocks publication.
 */
export function licenceLabel(value: string): string {
  return LICENCES.find((l) => l.value === value)?.label ?? value;
}
