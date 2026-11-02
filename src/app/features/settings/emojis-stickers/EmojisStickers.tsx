import React, { useState } from 'react';
import { Box, Text, IconButton, Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { GlobalPacks } from './GlobalPacks';
import { ServerPack } from './ServerPack';
import { UserPack } from './UserPack';
import { ImagePack } from '../../../plugins/custom-emoji';
import { ImagePackView } from '../../../components/image-pack-view';

type EmojisStickersProps = {
  requestClose: () => void;
};
export function EmojisStickers({ requestClose }: EmojisStickersProps) {
  const { t } = useTranslation();
  const [imagePack, setImagePack] = useState<ImagePack>();

  const handleImagePackViewClose = () => {
    setImagePack(undefined);
  };

  if (imagePack) {
    return <ImagePackView address={imagePack.address} requestClose={handleImagePackViewClose} />;
  }

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader outlined={false}>
            <Box grow="Yes" gap="200">
              <Box grow="Yes" alignItems="Center" gap="200">
                <Text size="H3" truncate>
                  {t('featureUi.settings.emojisStickers.emojisStickers')}
                </Text>
              </Box>
              <Box shrink="No">
                <IconButton onClick={requestClose} variant="Surface">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Box>
            </Box>
          </PageHeader>
        }
      >
        <PageContent>
          <Box direction="Column" gap="700">
            <UserPack onViewPack={setImagePack} />
            <ServerPack onViewPack={setImagePack} />
            <GlobalPacks onViewPack={setImagePack} />
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
