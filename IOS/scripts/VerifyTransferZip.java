import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Independent Android/JDK ZipOutputStream and ZipInputStream interoperability
 * oracle. The payload is self-authored and contains no user library data. */
public class VerifyTransferZip {
    private static String sha(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    private static Map<String, byte[]> payload() throws Exception {
        var files = new LinkedHashMap<String, byte[]>();
        files.put("database.rows", "{\"version\":2,\"schema\":13}\n".getBytes(StandardCharsets.UTF_8));
        files.put("settings.json", "{}".getBytes(StandardCharsets.UTF_8));
        byte[] binary = new byte[1024 * 1024 + 37];
        for (int i = 0; i < binary.length; i++) binary[i] = (byte)(i % 251);
        files.put("files/插图.bin", binary); files.put("files/empty", new byte[0]);
        var entries = new ArrayList<String>(); long expanded = 0;
        for (var entry : files.entrySet()) {
            entries.add("{\"path\":\"" + entry.getKey() + "\",\"size\":" + entry.getValue().length + ",\"sha256\":\"" + sha(entry.getValue()) + "\"}");
            expanded += entry.getValue().length;
        }
        String manifest = "{\"format\":\"ciallo-transfer\",\"version\":2,\"schema\":13,\"packageId\":\"01234567-89ab-cdef-0123-456789abcdef\",\"createdAt\":1,\"categories\":[\"BOOKS\"],\"counts\":{},\"warnings\":[],\"containsProtected\":false,\"protectedFavorites\":false,\"expandedBytes\":" + expanded + ",\"entries\":[" + String.join(",", entries) + "]}";
        var all = new LinkedHashMap<String, byte[]>(); all.put("manifest.json", manifest.getBytes(StandardCharsets.UTF_8)); all.putAll(files); return all;
    }
    public static void main(String[] args) throws Exception {
        var expected = payload();
        if (args.length == 2 && args[0].equals("--fixture")) {
            Path target = Path.of(args[1]); Files.createDirectories(target.toAbsolutePath().getParent());
            try (var zip = new ZipOutputStream(Files.newOutputStream(target), StandardCharsets.UTF_8)) {
                for (var entry : expected.entrySet()) { var item = new ZipEntry(entry.getKey()); item.setTime(0); zip.putNextEntry(item); zip.write(entry.getValue()); zip.closeEntry(); }
            }
            System.out.println("Generated JDK DEFLATE/data-descriptor fixture: " + Files.size(target) + " bytes"); return;
        }
        if (args.length != 1) throw new IllegalArgumentException("Expected native ZIP path, or --fixture output.zip");
        var seen = new HashSet<String>();
        try (var input = new ZipInputStream(Files.newInputStream(Path.of(args[0])), StandardCharsets.UTF_8)) {
            ZipEntry entry; byte[] buffer = new byte[64 * 1024];
            while ((entry = input.getNextEntry()) != null) {
                if (!expected.containsKey(entry.getName()) || !seen.add(entry.getName())) throw new IOException("Unexpected or duplicate entry");
                var bytes = new ByteArrayOutputStream(); int count;
                while ((count = input.read(buffer)) >= 0) { if (bytes.size() + count > 2 * 1024 * 1024) throw new IOException("Oversized entry"); bytes.write(buffer, 0, count); }
                if (!Arrays.equals(bytes.toByteArray(), expected.get(entry.getName()))) throw new IOException("Entry bytes changed: " + entry.getName());
                input.closeEntry();
            }
        }
        if (!seen.equals(expected.keySet())) throw new IOException("Missing entries");
        System.out.println("JDK ZipInputStream verified all 5 native ZIP entries, Unicode paths, binary bytes and CRCs");
    }
}
