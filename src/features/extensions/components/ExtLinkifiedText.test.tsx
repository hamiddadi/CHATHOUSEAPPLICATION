/**
 * Unit test for ExtLinkifiedText's URL detection. Focus on the security- and
 * UX-sensitive rules:
 *  - scheme'd (http/https) and www. URLs are linkified and open via Linking,
 *  - bare domains are only linkified when they end in a whitelisted TLD, so
 *    plain filenames like "rapport.pdf" are left as inert text,
 *  - dangerous schemes (javascript:/file:) are never turned into links, and a
 *    tapped bare link is forced to https:// (no scheme injection).
 */
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ExtLinkifiedText } from './ExtLinkifiedText';

describe('ExtLinkifiedText', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does NOT linkify a plain filename (rapport.pdf)', () => {
    // A non-whitelisted TLD (pdf) must stay inert text: no "Open link" role.
    const { queryByRole } = render(
      <ExtLinkifiedText>Voici le rapport.pdf à relire</ExtLinkifiedText>,
    );
    expect(queryByRole('link')).toBeNull();
  });

  it('does NOT linkify other common file extensions (notes.txt, photo.jpg)', () => {
    const { queryByRole } = render(
      <ExtLinkifiedText>notes.txt and photo.jpg attached</ExtLinkifiedText>,
    );
    expect(queryByRole('link')).toBeNull();
  });

  it('linkifies a bare whitelisted domain and opens https:// on tap', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const { getByLabelText } = render(
      <ExtLinkifiedText>visit example.com/path now</ExtLinkifiedText>,
    );
    fireEvent.press(getByLabelText('Open link example.com/path'));
    // Scheme is forced to https:// — never the raw bare string.
    expect(openSpy).toHaveBeenCalledWith('https://example.com/path');
  });

  it('linkifies an explicit https:// URL', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const { getByLabelText } = render(
      <ExtLinkifiedText>see https://chathouse.app/r/demo end</ExtLinkifiedText>,
    );
    fireEvent.press(getByLabelText('Open link https://chathouse.app/r/demo'));
    expect(openSpy).toHaveBeenCalledWith('https://chathouse.app/r/demo');
  });

  it('never linkifies javascript: or file: schemes', () => {
    const { queryByRole } = render(
      <ExtLinkifiedText>javascript:alert(1) and file:///etc/passwd</ExtLinkifiedText>,
    );
    expect(queryByRole('link')).toBeNull();
  });
});
