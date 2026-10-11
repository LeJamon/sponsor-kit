export function useProjectSelection() {
  const cookie = useCookie<string | null>('acme-project', { sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  const selectedId = useState<string | null>('console-selected-project', () => cookie.value || null)

  function selectProject(publicId: string | null) {
    selectedId.value = publicId
    cookie.value = publicId
  }

  return { selectedId, selectProject }
}
