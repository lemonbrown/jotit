import { csvToNotes } from './csv.js'
import { isDocxFile, parseDocxToText } from './docx.js'
import { createImportedDocxNote, createImportedOpenApiNote, createImportedTextNote } from './noteFactories.js'
import { looksLikeOpenApiJsonFile, parseOpenApiJson } from './openapi/parse.js'
import { createSQLiteAssetFromFile, isSQLiteFileName } from './sqliteAssets.js'
import { createImportedSQLiteNote } from './sqliteNote.js'
import { generateId } from './helpers.js'

function looksBinary(text) {
  return (text.slice(0, 1024).match(/\0/g) ?? []).length > 10
}

export async function importFiles(files, maxFileSize, deps = {}) {
  const {
    createTextNote = createImportedTextNote,
    createOpenApiNote = createImportedOpenApiNote,
    createDocxNote = createImportedDocxNote,
    createSqliteAsset = createSQLiteAssetFromFile,
    createSqliteNote = createImportedSQLiteNote,
    categorizeText = () => [],
    csvToNotesImpl = csvToNotes,
    isSQLiteName = isSQLiteFileName,
    isDocxName = isDocxFile,
    parseDocx = parseDocxToText,
    makeId = generateId,
    collectionId = null,
    upsertNote = () => {},
  } = deps

  const withCollection = note => collectionId ? { ...note, collectionId } : note

  const results = await Promise.all(files.map(async (file) => {
    if (file.size > maxFileSize) return []

    if (isSQLiteName(file.name)) {
      const assetId = makeId()
      await createSqliteAsset(file, assetId)
      const note = withCollection(createSqliteNote(file.name, assetId))
      upsertNote(note)
      return [note]
    }

    if (isDocxName(file.name)) {
      try {
        const text = await parseDocx(file)
        const note = withCollection(createDocxNote(file.name, text))
        upsertNote(note)
        return [note]
      } catch {
        return []
      }
    }

    let text
    try {
      text = await file.text()
    } catch {
      return []
    }

    if (looksBinary(text)) return []

    if (looksLikeOpenApiJsonFile(file.name, text)) {
      try {
        const document = parseOpenApiJson(text)
        const note = withCollection(createOpenApiNote(file.name, document))
        upsertNote(note)
        return [note]
      } catch {
        return []
      }
    }

    if (file.name.toLowerCase().endsWith('.csv')) {
      const notes = csvToNotesImpl(text).map(note => ({
        ...note,
        collectionId: collectionId ?? note.collectionId ?? null,
        categories: note.categories.length ? note.categories : categorizeText(note.content),
      }))

      for (const note of notes) upsertNote(note)
      return notes
    }

    const note = withCollection(createTextNote(file.name, text))
    upsertNote(note)
    return [note]
  }))

  return results.flat()
}

export async function importDroppedFiles(files, maxFileSize, { collectionId = null } = {}) {
  const { upsertNoteSync } = await import('./db.js')
  const { categorizeByPatterns } = await import('./patternCategories.js')
  return importFiles(files, maxFileSize, {
    upsertNote: upsertNoteSync,
    categorizeText: categorizeByPatterns,
    collectionId,
  })
}
