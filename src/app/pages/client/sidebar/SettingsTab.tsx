import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text } from 'folds';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { SidebarItem, SidebarItemTooltip, SidebarAvatar } from '../../../components/sidebar';
import { UserAvatar } from '../../../components/user-avatar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { authenticatedMediaRequestInit } from '../../../utils/mediaUrl';
import { nameInitials } from '../../../utils/common';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { Modal500 } from '../../../components/Modal500';
import { useActiveSession, useStoredSessions } from '../../../hooks/useSessionStore';
import { setActiveSession, updateSessionProfile } from '../../../state/sessions';
import { settingsModalAtom } from '../../../state/settingsModal';
import { getLoginPath } from '../../pathUtils';
import { withAddAccountSearch } from '../../auth/addAccount';
import { removeStoredSession } from '../../../../client/initMatrix';
import { AccountSwitcher, AccountSwitcherItem } from './AccountSwitcher';
import { resolveSessionRestorePath } from '../sessionRouteRestore';
import { useSimpleMode } from '../../../mindroom/settings/useMindroomAccountSettings';

const blobToDataUrl = async (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export function SettingsTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const rawActiveSession = useActiveSession();
  const sessions = useStoredSessions();
  const activeSession = useMemo(
    () =>
      sessions.find((session) => session.sessionId === rawActiveSession?.sessionId) ??
      rawActiveSession,
    [rawActiveSession, sessions]
  );
  const userId = mx.getUserId() ?? activeSession?.userId ?? '';
  const profile = useUserProfile(userId);

  const [accountSwitcher, setAccountSwitcher] = useState(false);
  const [removingSessionId, setRemovingSessionId] = useState<string>();
  const [accountActionError, setAccountActionError] = useState<string>();
  // Simple mode hides the Add Account entry point; Manage accounts stays so
  // an existing multi-account setup can still switch.
  const simpleMode = useSimpleMode();

  const displayName = profile.isDisplayNameResolved
    ? profile.displayName ?? getMxIdLocalPart(userId) ?? userId
    : activeSession?.lastKnownDisplayName ??
      profile.displayName ??
      getMxIdLocalPart(userId) ??
      userId;
  const activeSessionId = activeSession?.sessionId;
  const lastKnownAvatarUrl = activeSession?.lastKnownAvatarUrl;
  const lastKnownAvatarDataUrl = activeSession?.lastKnownAvatarDataUrl;
  const avatarUrl = profile.avatarUrl
    ? mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;
  const lastKnownAvatarHttpUrl = lastKnownAvatarUrl
    ? mxcUrlToHttp(mx, lastKnownAvatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  useEffect(() => {
    if (!activeSessionId) return;

    const update: {
      lastKnownDisplayName?: string;
      lastKnownAvatarUrl?: string;
      lastKnownAvatarDataUrl?: undefined;
    } = {};
    if (profile.isDisplayNameResolved) {
      update.lastKnownDisplayName = displayName;
    }
    if (profile.avatarUrl !== undefined || profile.isAvatarResolved) {
      update.lastKnownAvatarUrl = profile.avatarUrl;
      // A changed avatar must invalidate the cached thumbnail in the same
      // write: this update re-renders and aborts the in-flight refetch, and
      // a surviving stale dataUrl would then satisfy the fetch effect's
      // cache guard forever. This applies to UNRESOLVED urls too (the
      // mx.getUser mount seed) — the persist above already recorded them,
      // so skipping the invalidation here would pin the stale thumbnail.
      if (profile.avatarUrl !== lastKnownAvatarUrl && lastKnownAvatarDataUrl) {
        update.lastKnownAvatarDataUrl = undefined;
      }
    }
    if (Object.keys(update).length > 0) updateSessionProfile(activeSessionId, update);
  }, [
    activeSessionId,
    displayName,
    lastKnownAvatarDataUrl,
    lastKnownAvatarUrl,
    profile.avatarUrl,
    profile.displayName,
    profile.isAvatarResolved,
    profile.isDisplayNameResolved,
  ]);

  useEffect(() => {
    if (!activeSessionId) return undefined;
    if (profile.isAvatarResolved && !profile.avatarUrl) {
      updateSessionProfile(activeSessionId, {
        lastKnownAvatarDataUrl: undefined,
      });
      return undefined;
    }
    if (!profile.isAvatarResolved && !profile.avatarUrl && lastKnownAvatarDataUrl) {
      return undefined;
    }
    const avatarFetchUrl = avatarUrl ?? lastKnownAvatarHttpUrl;
    if (!avatarFetchUrl) return undefined;
    if (profile.avatarUrl === lastKnownAvatarUrl && lastKnownAvatarDataUrl) {
      return undefined;
    }

    const abortController = new AbortController();

    fetch(avatarFetchUrl, {
      signal: abortController.signal,
      ...(useAuthentication ? authenticatedMediaRequestInit(mx, avatarFetchUrl) : undefined),
    })
      .then(async (response) => {
        if (!response.ok) return undefined;
        const blob = await response.blob();
        if (blob.size > 128 * 1024) return undefined;
        return blobToDataUrl(blob);
      })
      .then((dataUrl) => {
        if (abortController.signal.aborted || !dataUrl) return;
        updateSessionProfile(activeSessionId, {
          lastKnownAvatarDataUrl: dataUrl,
        });
      })
      .catch(() => undefined);

    return () => {
      abortController.abort();
    };
  }, [
    activeSessionId,
    avatarUrl,
    lastKnownAvatarDataUrl,
    lastKnownAvatarHttpUrl,
    lastKnownAvatarUrl,
    mx,
    profile.avatarUrl,
    profile.isAvatarResolved,
    useAuthentication,
  ]);

  const accountItems = useMemo<AccountSwitcherItem[]>(
    () =>
      sessions.map((session) => {
        const active = session.sessionId === activeSession?.sessionId;
        return {
          session,
          active,
          displayName: active
            ? displayName
            : session.lastKnownDisplayName ?? getMxIdLocalPart(session.userId) ?? session.userId,
          avatarUrl: session.lastKnownAvatarDataUrl,
        };
      }),
    [activeSession?.sessionId, displayName, sessions]
  );

  const openAccountSwitcher = () => setAccountSwitcher(true);
  const closeAccountSwitcher = () => {
    setAccountSwitcher(false);
    setAccountActionError(undefined);
  };
  const openSettings = () => setSettingsModal({});
  const openSettingsFromSwitcher = () => {
    closeAccountSwitcher();
    openSettings();
  };

  const addAccount = () => {
    closeAccountSwitcher();
    navigate(withAddAccountSearch(getLoginPath(activeSession?.baseUrl ?? mx.baseUrl)));
  };

  const switchAccount = (sessionId: string, path?: string) => {
    setAccountActionError(undefined);
    try {
      if (!setActiveSession(sessionId)) {
        setAccountActionError(t('accountSwitcher.actionError'));
        setAccountSwitcher(true);
        return;
      }
    } catch {
      setAccountActionError(t('accountSwitcher.actionError'));
      setAccountSwitcher(true);
      return;
    }
    closeAccountSwitcher();
    navigate(resolveSessionRestorePath(path));
  };

  const removeAccount = async (sessionId: string) => {
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (!session || session.sessionId === activeSession?.sessionId) return;

    setAccountActionError(undefined);
    setRemovingSessionId(sessionId);
    try {
      await removeStoredSession(session);
    } catch {
      setAccountActionError(t('accountSwitcher.actionError'));
    } finally {
      setRemovingSessionId((current) => (current === sessionId ? undefined : current));
    }
  };

  return (
    <>
      {accountItems.map(
        ({ session, active, displayName: sessionDisplayName, avatarUrl: sessionAvatarUrl }) => (
          <SidebarItem key={session.sessionId} active={active}>
            <SidebarItemTooltip
              tooltip={
                active
                  ? t('accountsRail.settingsTooltip', { name: sessionDisplayName })
                  : t('accountsRail.switchTooltip', {
                      name: sessionDisplayName,
                      userId: session.userId,
                    })
              }
            >
              {(triggerRef) => (
                <SidebarAvatar
                  as="button"
                  aria-label={
                    active
                      ? t('accountsRail.openSettingsAria', { name: sessionDisplayName })
                      : t('accountsRail.switchAria', {
                          name: sessionDisplayName,
                          userId: session.userId,
                        })
                  }
                  ref={triggerRef}
                  onClick={() => {
                    if (active) {
                      openSettings();
                      return;
                    }

                    switchAccount(session.sessionId, session.lastKnownPath);
                  }}
                >
                  <UserAvatar
                    userId={session.userId}
                    src={sessionAvatarUrl}
                    renderFallback={() => <Text size="H4">{nameInitials(sessionDisplayName)}</Text>}
                  />
                </SidebarAvatar>
              )}
            </SidebarItemTooltip>
          </SidebarItem>
        )
      )}
      {accountItems.length > 1 && (
        <SidebarItem>
          <SidebarItemTooltip tooltip={t('accountsRail.manageAccounts')}>
            {(triggerRef) => (
              <SidebarAvatar
                as="button"
                aria-label={t('accountsRail.manageAccounts')}
                ref={triggerRef}
                outlined
                onClick={openAccountSwitcher}
              >
                <Icon src={Icons.User} />
              </SidebarAvatar>
            )}
          </SidebarItemTooltip>
        </SidebarItem>
      )}
      {!simpleMode && (
        <SidebarItem>
          <SidebarItemTooltip tooltip={t('accountsRail.addAccount')}>
            {(triggerRef) => (
              <SidebarAvatar
                as="button"
                aria-label={t('accountsRail.addAccountAria')}
                ref={triggerRef}
                outlined
                onClick={addAccount}
              >
                <Icon src={Icons.Plus} />
              </SidebarAvatar>
            )}
          </SidebarItemTooltip>
        </SidebarItem>
      )}
      {accountSwitcher && (
        <Modal500 requestClose={closeAccountSwitcher}>
          <AccountSwitcher
            accounts={accountItems}
            removingSessionId={removingSessionId}
            onOpenSettings={openSettingsFromSwitcher}
            onSwitchAccount={(session) => switchAccount(session.sessionId, session.lastKnownPath)}
            onRemoveAccount={(session) => {
              removeAccount(session.sessionId).catch(() => undefined);
            }}
            onAddAccount={simpleMode ? undefined : addAccount}
            onClose={closeAccountSwitcher}
            error={accountActionError}
          />
        </Modal500>
      )}
    </>
  );
}
