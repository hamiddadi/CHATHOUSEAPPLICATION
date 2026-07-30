import { readFileSync } from 'node:fs';

describe('native release guard wiring', () => {
  it('runs the versioned iOS wrapper explicitly through bash', () => {
    const project = readFileSync('ios/ChatHouse.xcodeproj/project.pbxproj', 'utf8');
    expect(project).toContain('scripts/bundle-react-native.sh');
    expect(project).toContain('exec /bin/bash \\"$BUNDLE_WRAPPER\\"');
  });

  it('validates iOS release inputs only after both Xcode env files are sourced', () => {
    const wrapper = readFileSync('ios/scripts/bundle-react-native.sh', 'utf8');
    const baseSource = wrapper.indexOf('source "$BASE_ENV_PATH"');
    const localSource = wrapper.indexOf('source "$LOCAL_ENV_PATH"');
    const releaseGuard = wrapper.indexOf('if [[ "$XCODE_CONFIGURATION" == "Release" ]]');

    expect(baseSource).toBeGreaterThan(-1);
    expect(localSource).toBeGreaterThan(baseSource);
    expect(releaseGuard).toBeGreaterThan(localSource);
    expect(wrapper).toContain('validate_firebase_plist');
    expect(wrapper).toContain('ENVFILE=.env.production');
  });

  it('keeps production checks out of the overridable base Xcode env file', () => {
    const baseEnv = readFileSync('ios/.xcode.env', 'utf8');
    expect(baseEnv).not.toContain('ENVFILE');
    expect(baseEnv).not.toContain('CONFIGURATION');
  });

  it('allows technical Android Release packaging only behind the explicit debug-key opt-in', () => {
    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    expect(gradle).toContain('CHATHOUSE_ALLOW_DEBUG_RELEASE_SIGNING');
    expect(gradle).toContain('validateProductionReleaseConfiguration()');
    expect(gradle).toContain("System.getenv('ENVFILE') != '.env.production'");
    expect(gradle).toContain(
      'taskName ==~ /^(assemble|bundle|package|install|publish).*release.*$/',
    );
    expect(gradle).toContain('validateProductionFirebase()');
  });
});
