/**
 * Central source of UI labels. Components import from here instead of
 * hardcoding "Device", "Store", etc. Terminology decisions live here.
 * DB / API / server-action identifiers are UNCHANGED — this file affects
 * user-facing strings only.
 */
export const copy = {
  // Entity labels (singular)
  screen: "Screen",
  location: "Location",
  screenGroup: "Screen Group",
  playlist: "Playlist",
  media: "Media",

  // Entity labels (plural)
  screens: "Screens",
  locations: "Locations",
  screenGroups: "Screen Groups",
  playlists: "Playlists",

  // Actions
  addScreen: "Add Screen",
  addLocation: "Add Location",
  addScreenGroup: "Add Screen Group",
  createPlaylist: "Create Playlist",
  uploadMedia: "Upload Media",
  syncNow: "Sync Now",
  unpair: "Unpair",
  rename: "Rename",
  delete: "Delete",

  // Statuses
  online: "Online",
  offline: "Offline",
  warning: "Warning",
  pending: "Pending",

  // Product
  productName: "Ouie Signage",
  productTagline: "Digital signage for places that care about details.",
} as const;

export type CopyKey = keyof typeof copy;
