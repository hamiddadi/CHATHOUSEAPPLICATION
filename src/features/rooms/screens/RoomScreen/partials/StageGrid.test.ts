import { getStageColumnCount } from './StageGrid';

describe('getStageColumnCount', () => {
  it('reduces the grid on narrow phones so speaker cells do not overlap', () => {
    expect(getStageColumnCount(320)).toBe(3);
    expect(getStageColumnCount(360)).toBe(3);
  });

  it('uses four columns when the available width can hold them', () => {
    expect(getStageColumnCount(390)).toBe(4);
  });

  it('caps the stage at five columns on wide layouts', () => {
    expect(getStageColumnCount(768)).toBe(5);
  });
});
