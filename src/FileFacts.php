<?php

namespace Ernestdefoe\Lectern;

use FoF\Upload\Events\File\WillBeUploaded;
use FoF\Upload\File;
use WeakMap;

/**
 * Counts a document's pages (PDF, Word) or sheets (spreadsheets) once, while
 * FoF Upload still holds the uploaded file, so the card can say "12 pages".
 *
 * The count rides on the File object for the rest of that upload request,
 * where FoF Upload asks the template for the BBCode it hands back to the
 * editor. Nothing is stored and nothing runs on any other request.
 */
class FileFacts
{
    /** PDFs and Word files bigger than this are not opened to count pages. */
    public const MAX_BYTES = 50 * 1024 * 1024;

    /** @var WeakMap<File, array{pages?: int, sheets?: int}>|null */
    private static ?WeakMap $facts = null;

    public function handle(WillBeUploaded $event): void
    {
        $path = $event->uploadedFile->getPathname();
        $name = $event->uploadedFile->getClientOriginalName() ?: $event->file->base_name;
        $facts = self::count($path, strtolower(pathinfo((string) $name, PATHINFO_EXTENSION)));

        if ($facts) {
            self::$facts ??= new WeakMap();
            self::$facts[$event->file] = $facts;
        }
    }

    /** @return array{pages?: int, sheets?: int} */
    public static function for(File $file): array
    {
        return self::$facts[$file] ?? [];
    }

    /** @return array{pages?: int, sheets?: int} */
    public static function count(string $path, string $extension): array
    {
        if (! is_file($path) || filesize($path) > self::MAX_BYTES) {
            return [];
        }

        $count = match ($extension) {
            'pdf' => ['pages' => self::pdfPages($path)],
            'docx' => ['pages' => self::zipMatch($path, 'docProps/app.xml', '/<Pages>(\d+)<\/Pages>/')],
            'xlsx', 'xlsm' => ['sheets' => self::zipCount($path, 'xl/workbook.xml', '/<sheet\b/')],
            default => [],
        };

        return array_filter($count, fn ($n) => $n !== null && $n > 0);
    }

    /**
     * The page tree's root carries the total in /Count, the largest one in the
     * file. PDF 1.5+ often hides it inside compressed object streams, which are
     * inflated too (at most 200 of them).
     */
    public static function pdfPages(string $path): ?int
    {
        $pdf = (string) file_get_contents($path);
        if (! str_starts_with(ltrim(substr($pdf, 0, 1024)), '%PDF')) {
            return null;
        }

        $max = self::maxCount($pdf);

        if (preg_match_all('/\/Type\s*\/ObjStm\b/', $pdf, $streams, PREG_OFFSET_CAPTURE)) {
            foreach (array_slice($streams[0], 0, 200) as [, $at]) {
                $start = strpos($pdf, 'stream', $at);
                $end = $start === false ? false : strpos($pdf, 'endstream', $start);
                if ($start === false || $end === false) {
                    continue;
                }
                $data = ltrim(substr($pdf, $start + 6, $end - $start - 6), "\r\n");
                $inflated = @gzuncompress($data);
                if ($inflated === false) {
                    $inflated = @gzinflate($data);
                }
                if ($inflated !== false) {
                    $max = max($max, self::maxCount($inflated));
                }
            }
        }

        return $max ?: null;
    }

    private static function maxCount(string $data): int
    {
        $max = 0;
        if (preg_match_all('/\/Type\s*\/Pages\b/', $data, $hits, PREG_OFFSET_CAPTURE)) {
            foreach (array_slice($hits[0], 0, 5000) as [, $at]) {
                // The dictionary around this /Type /Pages: back to its "<<", on to its ">>".
                $open = strrpos(substr($data, max(0, $at - 2000), min($at, 2000)), '<<');
                $close = strpos($data, '>>', $at);
                if ($open === false || $close === false) {
                    continue;
                }
                $dict = substr($data, max(0, $at - 2000) + $open, $close - (max(0, $at - 2000) + $open));
                if (preg_match('/\/Count\s+(\d+)/', $dict, $m)) {
                    $max = max($max, (int) $m[1]);
                }
            }
        }

        return $max;
    }

    private static function zipEntry(string $path, string $entry): ?string
    {
        if (! class_exists(\ZipArchive::class)) {
            return null;
        }
        $zip = new \ZipArchive();
        if ($zip->open($path, \ZipArchive::RDONLY) !== true) {
            return null;
        }
        $stat = $zip->statName($entry);
        // Small XML parts only: a bloated part is not read.
        $data = $stat && $stat['size'] <= 2 * 1024 * 1024 ? $zip->getFromName($entry) : false;
        $zip->close();

        return $data === false ? null : $data;
    }

    private static function zipMatch(string $path, string $entry, string $pattern): ?int
    {
        $xml = self::zipEntry($path, $entry);

        return $xml !== null && preg_match($pattern, $xml, $m) ? (int) $m[1] : null;
    }

    private static function zipCount(string $path, string $entry, string $pattern): ?int
    {
        $xml = self::zipEntry($path, $entry);

        return $xml === null ? null : preg_match_all($pattern, $xml);
    }
}
