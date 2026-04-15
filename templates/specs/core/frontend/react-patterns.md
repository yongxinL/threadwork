---
domain: frontend
name: react-patterns
updated: 2025-01-01
confidence: 0.9
tags: [react, hooks, state, components, typescript]
---
# React Patterns

## Rule: Always use custom hooks for business logic

Extract business logic from components into custom hooks. Components should only handle rendering and user events.

```tsx
// ✅ Correct: business logic in hook
function useUser(userId: string) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser(userId).then(setUser).finally(() => setLoading(false));
  }, [userId]);

  return { user, loading };
}

function UserCard({ userId }: { userId: string }) {
  const { user, loading } = useUser(userId);
  if (loading) return <Skeleton />;
  return <div>{user?.name}</div>;
}
```

```tsx
// ❌ Anti-pattern: business logic in component
function UserCard({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser(userId).then(setUser).finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <Skeleton />;
  return <div>{user?.name}</div>;
}
```

---

## Rule: Use composition over prop drilling

For deeply nested data needs, use React Context or component composition. Never pass props more than 2 levels deep.

```tsx
// ✅ Correct: context for shared state
const ThemeContext = createContext<Theme>('light');

function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Layout />
    </ThemeContext.Provider>
  );
}

function DeepComponent() {
  const theme = useContext(ThemeContext);
  return <div className={theme}>...</div>;
}
```

---

## Rule: Always type component props explicitly

All component props must have explicit TypeScript types. No `any`. No `React.FC` (prefer function declarations).

```tsx
// ✅ Correct
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

function Button({ label, onClick, disabled = false, variant = 'primary' }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-${variant}`}
    >
      {label}
    </button>
  );
}
```

---

## Rule: Memoize expensive computations, not everything

Only use `useMemo` and `useCallback` when:
1. The computation is genuinely expensive (> 1ms)
2. The value is used as a dependency of another hook
3. The function is passed to a child component that is itself memoized with `React.memo`

Premature memoization adds complexity without benefit.
