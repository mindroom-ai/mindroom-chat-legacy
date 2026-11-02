import React, { ReactNode, useRef } from 'react';
import { Scroll } from 'folds';

import {
  Sidebar,
  SidebarContent,
  SidebarStackSeparator,
  SidebarStack,
} from '../../components/sidebar';
import {
  DirectTab,
  HomeTab,
  SpaceTabs,
  InboxTab,
  ExploreTab,
  SettingsTab,
  UnverifiedTab,
  SearchTab,
  ThreadsTab,
  CanvasesTab,
} from './sidebar';
import { CreateTab } from './sidebar/CreateTab';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MindroomTab } from '../../mindroom/sidebar/MindroomTab';
import { useShowLocalMindroom } from '../../mindroom/local-mindroom/useShowLocalMindroom';
import {
  useShowCanvasesInSidebar,
  useSimpleMode,
} from '../../mindroom/settings/useMindroomAccountSettings';

export function SidebarNav({
  footer,
  onPageNavSelect,
}: {
  footer?: ReactNode;
  onPageNavSelect?: (selected: boolean) => boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sidebar, mindroom } = useClientConfig();
  // Simple mode keeps the essentials: Home, Direct, existing spaces, and the
  // sticky Inbox/Settings stack below.
  const simpleMode = useSimpleMode();
  // Allow deployments to hide optional sidebar entry points.
  const showThreads = !simpleMode && (sidebar?.showThreads ?? true);
  // Canvases come from agents in any interface mode; the user can still turn the button off.
  const canvasesWanted = useShowCanvasesInSidebar();
  const showCanvases = mindroom?.canvas?.enabled === true && canvasesWanted;
  const showExploreCommunity = simpleMode
    ? sidebar?.showExploreCommunityInSimpleMode ?? false
    : sidebar?.showExploreCommunity ?? true;
  const showAddSpace = !simpleMode && (sidebar?.showAddSpace ?? true);
  const localMindroom = useShowLocalMindroom();
  const showMindRoom = !simpleMode && localMindroom;
  const showSecondStack = showExploreCommunity || showMindRoom || showAddSpace;

  return (
    <Sidebar>
      <SidebarContent
        scrollable={
          <Scroll ref={scrollRef} variant="Background" size="0">
            <SidebarStack>
              <HomeTab onSelect={onPageNavSelect} />
              <DirectTab onSelect={onPageNavSelect} />
              {showThreads && <ThreadsTab onSelect={onPageNavSelect} />}
              {showCanvases && <CanvasesTab onSelect={onPageNavSelect} />}
            </SidebarStack>
            <SpaceTabs scrollRef={scrollRef} onSelect={onPageNavSelect} />
            {showSecondStack && (
              <>
                <SidebarStackSeparator />
                <SidebarStack>
                  {showExploreCommunity && <ExploreTab onSelect={onPageNavSelect} />}
                  {showMindRoom && <MindroomTab />}
                  {showAddSpace && <CreateTab />}
                </SidebarStack>
              </>
            )}
          </Scroll>
        }
        sticky={
          <>
            <SidebarStackSeparator />
            <SidebarStack>
              <SearchTab />
              <UnverifiedTab />
              <InboxTab />
              <SettingsTab />
            </SidebarStack>
            {footer && (
              <>
                <SidebarStackSeparator />
                <SidebarStack>{footer}</SidebarStack>
              </>
            )}
          </>
        }
      />
    </Sidebar>
  );
}
