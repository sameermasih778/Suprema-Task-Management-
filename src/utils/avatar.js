import avatarSuperAdmin from '../assets/avatar-super-admin.svg';
import avatarAdmin from '../assets/avatar-admin.svg';
import avatarDeveloper from '../assets/avatar-developer.svg';
import avatarDefault from '../assets/avatar-default.svg';
import { assetUrl } from './api';

/**
 * Staff accounts use a fixed role emblem instead of a personal photo.
 *
 * Staff are identified by their *system* role, not their role inside a
 * workspace - a developer who is merely the "owner" of a workspace is still
 * staff. The emblem also makes it obvious at a glance which portal a person
 * is using in a screenshot or a shared screen.
 */
export const STAFF_ROLES = ['super_admin', 'admin', 'developer'];

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

/** Personal photos are for regular accounts only. */
export function canUploadAvatar(role) {
  return !isStaffRole(role);
}

const ROLE_AVATARS = {
  super_admin: avatarSuperAdmin,
  admin: avatarAdmin,
  developer: avatarDeveloper
};

/**
 * Resolve the avatar to render for a user.
 *
 * Priority:
 *   1. Staff (super_admin / admin / developer) -> their role emblem, always.
 *      Any previously uploaded photo is deliberately ignored so it is obvious
 *      at a glance which portal someone is in.
 *   2. Member / viewer with an upload -> their photo.
 *   3. Everyone else -> the neutral placeholder badge.
 *
 * The placeholder is a local SVG rather than a generated image: it needs no
 * third-party request, renders identically offline, and visually matches the
 * staff emblems instead of looking like a different product.
 *
 * @param {object} user
 * @param {string} [roleOverride] Use when the system role is exposed under a
 *        different key (e.g. `global_role` on workspace members, or
 *        `user_role` on activity entries).
 */
export function getAvatarUrl(user, roleOverride) {
  if (!user) return avatarDefault;

  const role = roleOverride ?? user.global_role ?? user.user_role ?? user.role;

  // Staff emblem wins over anything stored.
  if (isStaffRole(role) && ROLE_AVATARS[role]) {
    return ROLE_AVATARS[role];
  }

  if (user.avatar_url) return assetUrl(user.avatar_url);

  return avatarDefault;
}

/** Convenience wrapper for list rows that expose only name + avatar. */
export function getAvatarFor(person, roleKey) {
  if (!person) return null;
  return getAvatarUrl(
    { name: person.name, avatar_url: person.avatar_url },
    roleKey ? person[roleKey] : undefined
  );
}

/**
 * Up to two initials for a name, used when a picture cannot be shown.
 * "Ill Islamic" -> "II", "Sameer Khokhar" -> "SK".
 */
export function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}