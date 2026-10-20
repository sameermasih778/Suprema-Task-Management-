import React, { useState } from 'react';
import { getAvatarUrl, initialsOf, isStaffRole } from '../utils/avatar';

/**
 * A user's picture, with a graceful fallback.
 *
 * Why this exists: a stored avatar URL can fail for reasons that have nothing
 * to do with our code. Google rate-limits its picture CDN (HTTP 429), a
 * Cloudinary asset can be deleted, a local file can be cleared. A bare
 * <img src={...}> then renders the browser's broken-image icon - and, worse,
 * the browser paints the alt text over the layout until the image resolves.
 *
 * So every avatar in the app goes through here:
 *   - staff  -> their role emblem (a local asset, cannot fail)
 *   - a photo that loads -> shown as-is
 *   - a photo that fails -> initials tile
 *   - no photo at all -> the local neutral placeholder
 *
 * @param {object} props
 * @param {object} props.person     The user record ({ name, avatar_url, role })
 * @param {string} [props.roleKey]  Key the role is exposed under, e.g. 'global_role'
 * @param {string} [props.className] Classes for the wrapper
 * @param {string} [props.alt]      Alt text; defaults to the person's name
 */
export default function Avatar({ person, roleKey, className = '', alt }) {
  const role = roleKey
    ? person?.[roleKey]
    : person?.global_role ?? person?.user_role ?? person?.role;

  const isStaff = isStaffRole(role);
  const src = getAvatarUrl(person, roleKey);

  // Derived rather than reset in an effect: the failure is remembered for the
  // exact URL that failed, so a new URL is always retried.
  const [brokenSrc, setBrokenSrc] = useState(null);
  const broken = brokenSrc === src;

  // Staff emblems and the local placeholder are bundled assets: they always
  // load, so there is nothing to fall back from.
  const isLocalAsset = !isStaff && !person?.avatar_url;

  if (isLocalAsset || (isStaff && !broken)) {
    return (
      <img
        src={src}
        alt={alt ?? person?.name ?? 'Avatar'}
        className={className}
      />
    );
  }

  if (broken) {
    return (
      <span
        className={`flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-600 font-black text-white ${className}`}
        title={person?.name || 'Avatar'}
      >
        {initialsOf(person?.name)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? person?.name ?? 'Avatar'}
      className={className}
      onError={() => setBrokenSrc(src)}
    />
  );
}
