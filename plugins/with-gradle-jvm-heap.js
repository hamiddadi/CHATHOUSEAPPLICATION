// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Local Expo config plugin — injects JVM heap + parallelism settings into
 * `android/gradle.properties` so the Gradle build doesn't OOM-kill the
 * worker daemons. Symptom without this plugin (seen on Windows builds
 * running react-native-agora + a dozen other native modules):
 *
 *     Failed to run Gradle Worker Daemon
 *     Unable to connect to the child process 'Gradle Worker Daemon 1'.
 *     The connection attempt hit a timeout after 120,0 seconds.
 *
 * Tuned for a RAM-CONSTRAINED machine (≈8 GB total, ~1 GB free with an IDE +
 * browsers open). The Expo default (-Xmx4g + 4 parallel workers + a 2 GB Kotlin
 * daemon) over-commits ~8 GB and OOM-killed the worker daemon mid-compile.
 * Serial compilation with bounded heaps is what made the build complete here.
 * (Agora was removed from the deps, so there's also less native code to build.)
 *
 * Settings rationale:
 *  - -Xmx2048m / MaxMetaspaceSize=512m : enough for the app/DEX phase without
 *                  starving the rest of the machine.
 *  - parallel=false / workers.max=1 : compile modules one at a time so peak
 *                  RAM stays ~one worker JVM, not four. Slower but reliable.
 *  - kotlin.daemon.jvmargs=-Xmx1280m : the Kotlin daemon is a separate JVM.
 *  - caching=true: build cache reuses unchanged task outputs across builds.
 *
 * On a machine with 16+ GB free you can raise -Xmx to 4g, flip parallel back to
 * true and workers.max to 3-4 for a much faster build.
 */
const PROPERTIES = [
  {
    key: 'org.gradle.jvmargs',
    value: '-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8',
  },
  { key: 'org.gradle.parallel', value: 'false' },
  { key: 'org.gradle.caching', value: 'true' },
  { key: 'org.gradle.daemon', value: 'true' },
  { key: 'org.gradle.workers.max', value: '1' },
  { key: 'kotlin.daemon.jvmargs', value: '-Xmx1280m' },
];

const withGradleJvmHeap = config =>
  withGradleProperties(config, mod => {
    for (const { key, value } of PROPERTIES) {
      const idx = mod.modResults.findIndex(item => item.type === 'property' && item.key === key);
      const entry = { type: 'property', key, value };
      if (idx >= 0) {
        mod.modResults[idx] = entry;
      } else {
        mod.modResults.push(entry);
      }
    }
    return mod;
  });

module.exports = withGradleJvmHeap;
