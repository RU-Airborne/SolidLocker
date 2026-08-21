const shortName = (path: string) => path.split("/").pop() ?? path;

const listNames = (paths: string[], max = 3): string => {
  const names = paths.slice(0, max).map(shortName).join(", ");
  const more = paths.length > max ? ` and ${paths.length - max} more` : "";
  return `${names}${more}`;
};

export const copy = {
  // Sync and sharing
  sharedOk: "Shared with your team on GitHub.",
  offlineRetry: "Could not reach GitHub. Will retry automatically.",
  syncedOk: "Checked GitHub. Everything is now up to date.",
  syncedChanges: (n: number) =>
    `Synced ${n} change${n === 1 ? "" : "s"} from your team.`,
  switchedBranch: (name: string) => `Switched to branch ${name}.`,

  // Stuck cross-branch files
  stuckFiles: (files: string[]) =>
    `${listNames(files)} still show the previous branch's version because SolidWorks had them open during the switch. Close them in SolidWorks, then press Fix now.`,
  stuckFixed: "Fixed. Those files now match this branch.",

  // Switching branches
  switching: (branch: string) => `Switching to ${branch}…`,
  switchingDetail:
    "Every file is being swapped to the other branch's version. Locking and sharing are paused until this finishes.",
  keptDuringSwitch: (files: string[]) =>
    `${listNames(files)} ${files.length === 1 ? "was" : "were"} saved while the branch was switching, so ${files.length === 1 ? "it" : "they"} still ${files.length === 1 ? "holds" : "hold"} unsaved work. Nothing was thrown away. Save & Share to keep ${files.length === 1 ? "it" : "them"}, or unlock to go back to the shared version.`,

  // Locks
  claimedOk: (paths: string[]) =>
    paths.length === 1
      ? `Locked ${listNames(paths)}. It is yours until you unlock it.`
      : `Locked ${paths.length} files: ${listNames(paths)}. They are yours until you unlock them.`,
  releasedOk: (paths: string[]) =>
    paths.length === 1
      ? `Unlocked ${listNames(paths)}. Your team can take it now.`
      : `Unlocked ${paths.length} files: ${listNames(paths)}. Your team can take them now.`,
  claimPartial: (claimed: number, total: number, held: string) =>
    `Locked ${claimed} of ${total}. Already taken: ${held}`,
  releasePartial: (released: number, total: number, first: string, more: number) =>
    released > 0
      ? `Unlocked ${released} of ${total}. ${first}${more > 0 ? ` (and ${more} more held back)` : ""}`
      : `${first}${more > 0 ? ` (and ${more} more held back)` : ""}`,
  lockedWhileOpen: (name: string, owner: string | null) =>
    `${owner ?? "Someone"} just locked ${name}, and you have it open in SolidWorks. Close it without saving — your copy is no longer the shared one.`,
  freedFiles: (names: string[]) =>
    `Now free: ${names.join(", ")}.`,
  freedNotificationTitle: "A file you were waiting on is now unlocked",
  freedNotificationBody: (name: string) =>
    `${name} was just unlocked.`,
  staleClaims: (files: string[], days: number) =>
    `You have locked ${listNames(files)} for over ${days === 1 ? "a day" : `${days} days`} without new changes. Be a good boy/girl/soul and unlock what you are done with so teammates can work on ${files.length === 1 ? "it" : "them"}.`,

  // Permissions
  permsChecked: (writable: number, readonly: number, anomalies: number) =>
    `Permissions checked: ${writable} made writable, ${readonly} protected` +
    (anomalies > 0 ? `. ${anomalies} file(s) need attention` : ""),

  // Banners
  cantVerifyClaims:
    "Can't verify locks with GitHub right now. \"Who has what\" may be missing teammates' locks. If this doesn't clear, check your internet and make sure you're signed in to GitHub (opening GitHub Desktop or doing any git pull triggers the sign in).",
  noLockingRules:
    "This branch has no file locking rules (.gitattributes with `lockable`), so locking won't protect files here. Switch to a branch that has them, or ask your lead to add them to this branch.",
  locksMayBeStale:
    "Showing the last known locks. GitHub couldn't be verified just now, so this list may be out of date.",
  checkConnection:
    "Check your connection. SolidLocker can't reach GitHub, so locking, Save & Share, and unlocking are paused until you're back online.",
  notSignedIn:
    "You're not signed in to GitHub. Locking may not work, and \"Who has what\" may not be up to date. Sign in to GitHub to fix this.",
  offlineStillWorking:
    "You can still open and edit any file you locked before you lost connection. Need to work on a file you did not lock?",
  locksUnavailable: (detail: string) =>
    `Couldn't check locks with GitHub. This list may be missing locks held by teammates. ${detail}`,

  // Connection changes
  offlineNotificationTitle: "SolidLocker lost its connection",
  offlineNotificationBody:
    "Can't reach GitHub. Locking and unlocking are paused, and lock info may be out of date.",
  onlineNotificationTitle: "SolidLocker is back online",
  onlineNotificationBody: "Connected to GitHub again. Locks are up to date.",

  // Leaving with locks held
  exitHoldingClaims: (n: number) =>
    `You still hold ${n} locked file${n === 1 ? "" : "s"}. Teammates cannot work on ${n === 1 ? "it" : "them"} until you unlock. Close anyway?`,

  // Deleting files
  deletingUnlocked: (files: string[]) =>
    `This will remove ${listNames(files)} for the whole team, and you never locked ${files.length === 1 ? "it" : "them"}. Make sure nobody else is working on ${files.length === 1 ? "it" : "them"}.`,

  // Large files
  bigFileNote: (n: number, limitMb: number) =>
    `${n} selected file${n === 1 ? " is" : "s are"} larger than ${limitMb} MB. Sharing will work but syncs get slower for everyone.`,

  // Repository management
  nowManaging: (slug: string) => `Now managing ${slug}.`,
  downloadedAndManaging: (slug: string) =>
    `Downloaded and now managing ${slug}.`,
};
