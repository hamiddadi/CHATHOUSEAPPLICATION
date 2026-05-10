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
 * The defaults Expo ships with give Gradle ~512 MB heap which is well
 * under what's needed when 3+ native libs compile their AARs in parallel.
 *
 * Settings rationale:
 *  - -Xmx4096m   : 4 GB heap. Required for cleanly compiling Agora +
 *                  Reanimated + Maps + Screens in the same JVM.
 *  - MaxMetaspaceSize=1g : caps the class metadata segment. Prevents the
 *                  Kotlin compiler from blowing the JVM's metaspace on
 *                  monorepos with many compilation units.
 *  - parallel=true / workers.max=4 : run independent Gradle tasks in
 *                  parallel. 4 workers is sane on 4-8 core dev machines.
 *  - caching=true: enables the build cache; subsequent builds reuse
 *                  outputs of unchanged tasks. Cuts iteration time ~5x.
 *  - kotlin.daemon.jvmargs=-Xmx2g : the Kotlin daemon is separate from
 *                  the main Gradle JVM; it also crashed on default heap.
 *
 * If you keep hitting OOM despite this, bump -Xmx (8g if you have 16+ GB
 * of RAM) and reduce workers.max to 2.
 */
const PROPERTIES = [
  {
    key: 'org.gradle.jvmargs',
    value: '-Xmx4096m -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
  },
  { key: 'org.gradle.parallel', value: 'true' },
  { key: 'org.gradle.caching', value: 'true' },
  { key: 'org.gradle.daemon', value: 'true' },
  { key: 'org.gradle.workers.max', value: '4' },
  { key: 'kotlin.daemon.jvmargs', value: '-Xmx2048m' },
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
