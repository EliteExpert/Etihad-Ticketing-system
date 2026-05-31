import {
  ActionRowBuilder,
  MediaGalleryBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { FOOTER_IMAGE_URL } from '../config.js';

export function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function media(url) {
  return new MediaGalleryBuilder().addItems({ media: { url } });
}

export function footerMedia() {
  return media(FOOTER_IMAGE_URL);
}

export function modal(customId, title, fields) {
  const m = new ModalBuilder().setCustomId(customId).setTitle(title);
  m.addComponents(
    ...fields.map(f =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(f.id)
          .setLabel(f.label)
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(f.placeholder ?? '')
      )
    )
  );
  return m;
}
