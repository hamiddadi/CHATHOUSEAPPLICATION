import { getInputBorderClass } from './Input.styles';

describe('getInputBorderClass', () => {
  it('uses the variant default while idle', () => {
    expect(getInputBorderClass('filled', false, false)).toBe('border-outline');
    expect(getInputBorderClass('outlined', false, false)).toBe('border-outline');
  });

  it('uses the focus border for both variants', () => {
    expect(getInputBorderClass('filled', true, false)).toBe('border-primary');
    expect(getInputBorderClass('outlined', true, false)).toBe('border-primary');
  });

  it('gives the error border priority over focus', () => {
    expect(getInputBorderClass('filled', true, true)).toBe('border-danger');
    expect(getInputBorderClass('outlined', true, true)).toBe('border-danger');
  });
});
