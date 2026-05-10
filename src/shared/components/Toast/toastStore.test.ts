import { toast, useToastStore } from './toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });

  it('show appends a toast with a unique id and returns it', () => {
    const id1 = useToastStore.getState().show({ message: 'first' });
    const id2 = useToastStore.getState().show({ message: 'second' });
    expect(id1).not.toBe(id2);
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map(t => t.message)).toEqual(['first', 'second']);
  });

  it('defaults tone to info and applies default duration', () => {
    useToastStore.getState().show({ message: 'hello' });
    const [t] = useToastStore.getState().toasts;
    expect(t?.tone).toBe('info');
    expect(t?.duration).toBeGreaterThan(0);
  });

  it('dismiss removes only the targeted toast', () => {
    const id1 = useToastStore.getState().show({ message: 'a' });
    useToastStore.getState().show({ message: 'b' });
    useToastStore.getState().dismiss(id1);
    const messages = useToastStore.getState().toasts.map(t => t.message);
    expect(messages).toEqual(['b']);
  });

  it('convenience helpers pass the right tone', () => {
    toast.error('err');
    toast.success('ok');
    toast.warning('careful');
    const tones = useToastStore.getState().toasts.map(t => t.tone);
    expect(tones).toEqual(['error', 'success', 'warning']);
  });
});
