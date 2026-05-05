import { APP_NAME, APP_NPUB } from '../app-identity.js';
import { FLIGHT_DECK_SCHEMA_BUNDLE } from '../generated/flightdeck-schema-bundle.js';
import { buildGroupPayloads, encryptOwnerPayload } from './record-crypto.js';

export function getFlightDeckSchemaBundle() {
  return FLIGHT_DECK_SCHEMA_BUNDLE;
}

export function appSchemaRecordFamilies() {
  return FLIGHT_DECK_SCHEMA_BUNDLE.schemas.map((schema) => ({
    record_family_hash: `${APP_NPUB}:${schema.collection_space}`,
    collection_space: schema.collection_space,
    schema_version: schema.schema_version,
    schema_hash: FLIGHT_DECK_SCHEMA_BUNDLE.schema_hash,
    title: schema.title,
    summary: schema.summary,
  }));
}

export async function buildAppSchemaManifestRequest({
  owner_npub,
  group_ids = [],
}) {
  const schemas = FLIGHT_DECK_SCHEMA_BUNDLE.schemas.map((schema) => ({
    ...schema,
    record_family_hash: `${APP_NPUB}:${schema.collection_space}`,
  }));
  const recordFamilies = appSchemaRecordFamilies();
  const payload = {
    app_namespace: APP_NPUB,
    collection_space: 'app_schema',
    schema_version: FLIGHT_DECK_SCHEMA_BUNDLE.bundle_schema_version,
    data: {
      app_npub: APP_NPUB,
      app_name: APP_NAME || 'Flight Deck',
      schema_hash: FLIGHT_DECK_SCHEMA_BUNDLE.schema_hash,
      schema_version: FLIGHT_DECK_SCHEMA_BUNDLE.bundle_schema_version,
      record_families: recordFamilies,
      schemas,
    },
  };
  const canWriteByGroup = new Map(
    [...new Set((group_ids || []).map((groupId) => String(groupId || '').trim()).filter(Boolean))]
      .map((groupId) => [groupId, false]),
  );

  return {
    app_name: APP_NAME || 'Flight Deck',
    schema_hash: FLIGHT_DECK_SCHEMA_BUNDLE.schema_hash,
    schema_version: FLIGHT_DECK_SCHEMA_BUNDLE.bundle_schema_version,
    record_families: recordFamilies,
    owner_payload: await encryptOwnerPayload(owner_npub, payload),
    group_payloads: await buildGroupPayloads(group_ids, payload, canWriteByGroup),
  };
}
