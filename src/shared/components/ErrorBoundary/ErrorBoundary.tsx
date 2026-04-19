import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level crash shield. Catches render errors thrown in its child tree
 * and shows a minimal recovery UI. Wire a reporter (e.g. Sentry) via `onError`.
 *
 * Class component is mandatory here — React hooks cannot implement
 * `componentDidCatch` / `getDerivedStateFromError`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    if (__DEV__) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  public override render(): ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;
    if (fallback) return fallback(error, this.reset);

    return <DefaultFallback error={error} onReset={this.reset} />;
  }
}

interface DefaultFallbackProps {
  error: Error;
  onReset: () => void;
}

const DefaultFallback: React.FC<DefaultFallbackProps> = ({ error, onReset }) => (
  <View
    accessibilityRole="alert"
    accessibilityLiveRegion="assertive"
    className="flex-1 items-center justify-center bg-background px-xxl gap-md"
  >
    <Text className="text-xl font-headline text-ink text-center">
      Quelque chose s'est mal passé
    </Text>
    <Text className="text-md font-body text-ink-muted text-center" numberOfLines={4}>
      {error.message || 'Une erreur inattendue est survenue.'}
    </Text>
    <Pressable
      onPress={onReset}
      accessibilityRole="button"
      accessibilityLabel="Réessayer"
      accessibilityHint="Tente de recharger l'écran en erreur"
      className="bg-primary rounded-pill px-xxl py-md min-h-[44px] items-center justify-center"
    >
      <Text className="text-sm font-display text-primary-on">Réessayer</Text>
    </Pressable>
  </View>
);
