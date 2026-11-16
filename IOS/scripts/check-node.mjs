/**
 * Node version gate — Capacitor 8 requires Node 22+.
 */
const major = Number(process.versions.node.split('.')[0]);
if (Number.isNaN(major) || major < 22) {
  console.error(
    `[check-node] Node ${process.versions.node} is too old. Capacitor 8 requires Node 22+.`,
  );
  process.exit(1);
}
