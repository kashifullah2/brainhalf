import { describe, expect, it } from 'vitest';
import { FileSnapshotAssembler, type FileSnapshotPage } from '../lib/file-snapshot';

describe('Versioned file snapshot assembly', () => {
  function setup() {
    const assembler = new FileSnapshotAssembler();
    const baseline = { '/src/App.jsx': 'original', '/src/removed.js': 'remove me' };
    const request = assembler.begin(baseline);
    const page: FileSnapshotPage = {
      type: 'files_snapshot', protocol: 2, requestId: request.requestId, revision: 9,
      offset: 0, nextOffset: 1, hasMore: true, files: { '/src/App.jsx': 'remote' },
    };
    return { assembler, baseline, request, page };
  }

  it('does not expose incomplete pages and requests the next raw-row offset', () => {
    const { assembler, baseline, page } = setup();
    const result = assembler.accept({ ...page, nextOffset: 3 }, baseline);
    expect(result.files).toBeUndefined();
    expect(result.request).toEqual({ type: 'get_files', requestId: page.requestId, revision: 9, offset: 3 });
    const completed = assembler.accept({ ...page, offset: 3, nextOffset: 4, hasMore: false, files: { '/src/other.js': 'other' } }, baseline);
    expect(completed.files).toEqual({ '/src/App.jsx': 'remote', '/src/other.js': 'other' });
  });

  it('preserves edits, new files and deletions made while paging', () => {
    const { assembler, baseline, page } = setup();
    assembler.accept(page, baseline);
    const current = { '/src/App.jsx': 'local edit', '/src/new.js': 'local new' };
    const result = assembler.accept({ ...page, offset: 1, nextOffset: 2, hasMore: false, files: { '/src/removed.js': 'remote outdated' } }, current);
    expect(result.files).toEqual(current);
  });

  it('accepts a complete empty snapshot as an intentional deletion', () => {
    const { assembler, baseline, page } = setup();
    expect(assembler.accept({ ...page, files: {}, nextOffset: 0, hasMore: false }, baseline).files).toEqual({});
  });

  it('advances through a page containing only filtered secret rows', () => {
    const { assembler, baseline, page } = setup();
    expect(assembler.accept({ ...page, files: {}, nextOffset: 200 }, baseline).request?.offset).toBe(200);
  });

  it.each([
    { nextOffset: 0 },
    { offset: 2 },
    { revision: -1 },
    { protocol: 1 },
    { files: { '/bad': null } },
  ])('rejects invalid pages without returning a replacement: %j', invalid => {
    const { assembler, baseline, page } = setup();
    expect(() => assembler.accept({ ...page, ...invalid } as FileSnapshotPage, baseline)).toThrow();
    expect(assembler.matches(page.requestId)).toBe(false);
  });

  it('rejects mixed revisions and ignores abandoned responses', () => {
    const { assembler, baseline, page } = setup();
    assembler.accept(page, baseline);
    expect(() => assembler.accept({ ...page, offset: 1, nextOffset: 2, revision: 10 }, baseline)).toThrow();
    assembler.begin(baseline);
    expect(assembler.accept(page, baseline)).toEqual({});
  });

  it('cancels a disconnected transfer without modifying files', () => {
    const { assembler, baseline, page } = setup();
    assembler.accept(page, baseline);
    assembler.cancel();
    expect(assembler.accept({ ...page, offset: 1, hasMore: false }, baseline)).toEqual({});
  });
});
