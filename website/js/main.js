AWS.config.update({
    region: awsConfigOptions.identity_pool_id.split(':')[0],
    credentials: new AWS.CognitoIdentityCredentials({
        IdentityPoolId: awsConfigOptions.identity_pool_id
    })
});
var DateTime = luxon.DateTime;

const iconMap = {
    '/': 'bi-folder',
    '.jpg': 'bi-file-earmark-image',
    '.bmp': 'bi-file-earmark-image',
    '.gif': 'bi-file-earmark-image',
    '.heic': 'bi-file-earmark-image',
    '.png': 'bi-file-earmark-image',
    '.raw': 'bi-file-earmark-image',
    '.svg': 'bi-file-earmark-image',
    '.tiff': 'bi-file-earmark-image',
    '.pdf': 'bi-file-earmark-pdf',
    '.zip': 'bi-file-earmark-zip',
    '.pkg': 'bi-file-earmark-zip',
    '.tar.gz': 'bi-file-earmark-zip',
    '.gz': 'bi-file-earmark-zip',
    '.xls': 'bi-file-earmark-excel',
    '.xlsx': 'bi-file-earmark-excel',
    '.doc': 'bi-file-earmark-word',
    '.docx': 'bi-file-earmark-word',
    '.ppt': 'bi-file-earmark-slides',
    '.pptx': 'bi-file-earmark-slides',

    '.aac': 'bi-file-earmark-music',
    '.wav': 'bi-file-earmark-music',
    '.m4p': 'bi-file-earmark-music',
    '.mp3': 'bi-file-earmark-music',

    '.mov': 'bi-file-earmark-play',
    '.mp4': 'bi-file-earmark-play',

    '.css': 'bi-file-earmark-code',
    '.js': 'bi-file-earmark-code',
    '.json': 'bi-file-earmark-code',
    '.php': 'bi-file-earmark-code',
    '.py': 'bi-file-earmark-code',
    '.rb': 'bi-file-earmark-code',
    '.sass': 'bi-file-earmark-code',
    '.scss': 'bi-file-earmark-code',
    '.sh': 'bi-file-earmark-code',
    '.sql': 'bi-file-earmark-code',
    '.xml': 'bi-file-earmark-code',
    '.yml': 'bi-file-earmark-code',
    '.html': 'bi-file-earmark-code',
    '.java': 'bi-file-earmark-code',

    '.md': 'bi-file-earmark-text',
    '.txt': 'bi-file-earmark-text',

    '.csv': 'bi-file-earmark-spreadsheet',

    '.exe': 'bi-file-earmark-binary',

    '.ai': 'bi-filetype-ai',
    '.cs': 'bi-filetype-cs',
    '.jsx': 'bi-filetype-jsx',
    '.key': 'bi-filetype-key',
    '.mdx': 'bi-filetype-mdx',
    '.otf': 'bi-filetype-otf',
    '.psd': 'bi-filetype-psd',
    '.tsx': 'bi-filetype-tsx',
    '.ttf': 'bi-filetype-ttf',
    '.woff': 'bi-filetype-woff',
}

// Extensions treated as inline-viewable media (per the gallery feature). Kept separate from
// iconMap above since iconMap covers a broader set of extensions used only for icon display.
const galleryImageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const galleryVideoExtensions = ['.mp4', '.webm', '.mov'];

function isGalleryImageKey(key) {
    const keyLow = key.toLowerCase();
    return galleryImageExtensions.some(ext => keyLow.endsWith(ext));
}

function isGalleryVideoKey(key) {
    const keyLow = key.toLowerCase();
    return galleryVideoExtensions.some(ext => keyLow.endsWith(ext));
}

// Holds the media (image/video) items rendered in the *current* listing page, in display order,
// so Next/Previous in the gallery can step through them. Rebuilt on every renderTable() call.
// Note: pagination ("Next »") fully reloads the row set via a new S3 call, so gallery navigation
// intentionally only walks the items on the currently displayed page and stops at that page's
// boundaries (Prev/Next buttons are disabled there) rather than fetching further pages.
let currentMediaList = [];
let currentMediaIndex = -1;
let mediaGalleryModalInstance = null;

function reset(prefix = "", start_at = "") {
    // TODO: Opportunity to clean this up, make it more flexible and not all hard-coded, but it works great as-is
    if (prefix === '' && start_at === '') {
        if (window.location.search !== '') {
            window.history.pushState('', '', '/');
        }
    } else if (prefix === '' && start_at !== '') {
        const encodedStartAt = encodeURI(start_at)
        if (window.location.search !== ('?s=' + encodedStartAt)) {
            window.history.pushState('', '', '/?s=' + encodedStartAt);
        }
    } else if (prefix !== '' && start_at === '') {
        const encodedPrefix = encodeURI(prefix)
        if (window.location.search !== ('?p=' + encodedPrefix)) {
            window.history.pushState('', '', '/?p=' + encodedPrefix);
        }
    } else if (prefix !== '' && start_at !== '') {
        const encodedPrefix = encodeURI(prefix)
        const encodedStartAt = encodeURI(start_at)
        if (window.location.search !== ('?p=' + encodedPrefix + '&s=' + encodedStartAt)) {
            window.history.pushState('', '', '/?p=' + encodedPrefix + '&s=' + encodedStartAt);
        }
    } else {
        console.log('Error.')
    }
    const decodedPrefix = decodeURI(prefix)
    const decodedStartAt = decodeURI(start_at)
    document.title = awsConfigOptions.site_name + ' - /' + decodedPrefix;
    $('#site_current_path').html(generate_title_breadcrumbs(prefix))
    renderTable(decodedPrefix, decodedStartAt);
}

function generate_title_breadcrumbs(prefix) {
    let prefix_split = prefix.split('/')
    let objLink = '/'
    let onClick = ' onclick="return localNav(\'\');"'
    let title_text = '<a class="link-dark" href="' + objLink + '"' + onClick + '>Home</a> / '
    let prior_paths = ''
    for (const item of prefix_split) {
        prior_paths += item + '/'
        objLink = '/?p=' + prior_paths
        onClick = ' onclick="return localNav(\'' + btoa(prior_paths) + '\');"'
        title_text += '<a class="link-dark" href="' + objLink + '"' + onClick + '>' + decodeURI(item) + '</a> / '
    }
    return title_text.substring(0, title_text.length - 3)
}

function renderTable(prefix, start_at = '') {
    // TODO: Could look at normalizing the prefix parameter here in case a trailing slash or something gets missed in the URL
    let s3 = new AWS.S3({
        apiVersion: "2006-03-01",
    });
    let params = {
        Bucket: awsConfigOptions.bucket_name,
        Delimiter: '/'
        //StartAfter: 'Lots of Files/548.txt'
    };
    if (start_at.length > 0) {
        params['StartAfter'] = start_at
    }
    if (prefix.length > 0) {
        params.Prefix = prefix
    }
    s3.listObjectsV2(params, function(err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            let newRows = ''
            currentMediaList = []
            //console.log(data);
            if (data['Prefix'].length > 0) {
                newRows += getRow('..', data['Prefix'], true)
            }
            let newKeys = get_display_order(data);
            for (const key of newKeys['Order']) {
                newRows += getRow(newKeys['Keys'][key], data['Prefix'])
            }
            if (newKeys['isTruncated'] === true) {
                newRows += getPagination(data['Prefix'], newKeys['Order'][newKeys['Order'].length - 1]);
            }
            $('#listing').html(newRows)
            observeVideoThumbnails()
        }
    });
}

function get_display_order(data) {
    // Interesting behavior here. S3 object/prefix lists are ordered lexicographically (UTF-8 byte order).
    // For this to make sense I'm proposing two modes:
    // <=1000 Objects/Prefixes
    //    - Sort how most filesystems do (lexicographically with folders always on top)
    //    - This makes the system make intuitive sense for 99% of listings and views
    // >1000 Objects
    //    - Strictly lexicographically so folders may be interspersed
    //    - While this is less intuitive it is consistent without listing the entire bucket. This would inflate
    //      costs and load times unnecessarily. The alternative would be to take each page and treat it as above
    //      but this leads to odd ordering that almost seems random since the top of one page is not always the
    //      next object of the previous page (it is all the next folders lexicographically).
    let newKeys = []
    let prefixKeys = []
    let objectKeys = []
    for (const item of data['CommonPrefixes']) {
        newKeys[item['Prefix']] = item
        prefixKeys.push(item['Prefix'])
    }
    for (const item of data['Contents']) {
        // Oddity here where sometimes the response contains its own key as an item?
        if (item['Key'] !== data['Prefix']) {
            newKeys[item['Key']] = item
            objectKeys.push(item['Key'])
        }
    }
    let isTruncated = false
    let newOrder = []
    if (data['IsTruncated'] === true || data.hasOwnProperty('StartAfter')) {
        // This response is either truncated, or a non-default starting point response (AKA subsequent page)
        // Sort strictly lexicographically so folders may be interspersed
        newOrder = Object.keys(newKeys).sort()
        isTruncated = true
    } else {
        // Sort how most filesystems do (lexicographically with folders always on top)
        newOrder = prefixKeys.sort().concat(objectKeys.sort())
    }
    return {
        'Keys': newKeys,
        'Order': newOrder,
        'isTruncated': isTruncated
    }
}

function getPagination(prefix, start_at) {
    objLink = '/?p=' + prefix + '&s=' + start_at
    onClick = ' onclick="return localNav(\'' + btoa(prefix) + '\', \'' + btoa(start_at) + '\');"'
    return '<div class="gallery_pagination"><a href="' + objLink + '"' + onClick + '>Next »</a></div>'
}

function getRow(item, prefix, isNavToParent = false) {
    let objKey = ''
    let objIcon = ''
    let objLink = ''
    let onClick = ''
    let objSize = ''
    let objSizeMouseover = ''
    let objModified = ''
    let objModifiedMouseover = ''
    let objClass = '';
    let objTarget = '';
    let mediaType = null;
    if (isNavToParent) {
        // It's a parent "folder" link
        objKey = '..'
        objIcon = 'bi-folder-symlink'
        let newPrefix = encodeURI(prefix.substring(0, prefix.lastIndexOf('/', prefix.length - 2) + 1))
        if (newPrefix.length == 0) {
            objLink = '/'
        } else {
            objLink = '/?p=' + newPrefix
        }
        onClick = ' onclick="return localNav(\'' + btoa(newPrefix) + '\');"'
    } else if (item.hasOwnProperty('Prefix')) {
        // It's a "folder"
        objKey = item['Prefix']
        objIcon = getBootstrapImageIcon(objKey)
        let newPrefix = encodeURI(objKey)
        objLink = '/?p=' + newPrefix
        onClick = ' onclick="return localNav(\'' + btoa(newPrefix) + '\');"'
    } else {
        // It's an object
        objClass = item['StorageClass']
        // Skip invisible object classes
        if (awsConfigOptions.visible_storage_classes.indexOf(objClass) === -1) { return '' }
        objKey = item['Key']
        objIcon = getBootstrapImageIcon(objKey)
        objSize = s3FileSize(item['Size'], 1)
        objSizeMouseover = item['Size'].toLocaleString() + ' Bytes'
        dt = DateTime.fromJSDate(item['LastModified'])
        objModified = dt.toFormat('yyyy-LL-dd HH:mm:ss')
        objModifiedMouseover = dt.toRelative()
        objLink = '/' + encodeURI(objKey)
        if (isGalleryImageKey(objKey)) {
            mediaType = 'image'
        } else if (isGalleryVideoKey(objKey)) {
            mediaType = 'video'
        }
        if (mediaType !== null) {
            // Open in the in-page gallery viewer instead of downloading/navigating away.
            onClick = ' onclick="return openMediaGallery(\'' + btoa(objLink) + '\');"'
        } else if (awsConfigOptions.files_open_in_new_tab) {
            objTarget = ' target="_blank"'
        }
    }
    if (!isNavToParent && objKey.substring(0, prefix.length) == prefix) {
        objKey = objKey.substring(prefix.length)
    }
    if (mediaType !== null) {
        currentMediaList.push({
            key: objLink,
            url: objLink,
            type: mediaType,
            displayName: objKey
        })
    }
    let tileClasses = 'gallery_tile'
    if (mediaType === 'image') { tileClasses += ' thumb_link' }
    if (mediaType === 'video') { tileClasses += ' thumb_link video_thumb' }

    let visualHtml
    if (mediaType === 'image') {
        visualHtml = '<img class="gallery_tile_visual" src="' + objLink + '" loading="lazy" alt="">'
    } else if (mediaType === 'video') {
        visualHtml = '<span class="gallery_tile_visual icon_tile video_frame_thumb" data-video-src="' + objLink + '"><i class="bi bi-play-circle-fill gallery_tile_icon"></i></span>'
    } else {
        visualHtml = '<span class="gallery_tile_visual icon_tile"><i class="bi ' + objIcon + ' gallery_tile_icon"></i></span>'
    }

    let titleParts = [objKey]
    if (objSizeMouseover) { titleParts.push(objSizeMouseover) }
    if (objModifiedMouseover) { titleParts.push(objModifiedMouseover) }
    let tileTitle = escapeHtml(titleParts.join(' — '))

    let sizeHtml = objSize ? '<div class="gallery_tile_size">' + escapeHtml(objSize) + '</div>' : ''

    return '<a class="' + tileClasses + '" href="' + objLink + '"' + onClick + objTarget + ' title="' + tileTitle + '">' +
        visualHtml +
        '<div class="gallery_tile_label">' + escapeHtml(objKey) + '</div>' +
        sizeHtml +
        '</a>'
}

function getBootstrapImageIcon(key) {
    keyLow = key.toLowerCase()
    for (const [searchEnding, iconClass] of Object.entries(iconMap)) {
        if (keyLow.endsWith(searchEnding)) {
            return iconClass
        }
    }
    return 'bi-file'
}

$( document ).ready(function() {
	awsConfigOptions.visible_storage_classes = awsConfigOptions.visible_storage_classes.toUpperCase().split(',');
    processUrl();
    initMediaGallery();
    initGallerySizeSlider();
    initVideoThumbnailObserver();
    initAuthStatus();
});

// --- Login status indicator (Sign in / Signed in as ... Sign out) in the toolbar ---
function authIsConfigured() {
    return !!awsConfigOptions.user_pool_id && awsConfigOptions.user_pool_id.indexOf('REPLACE_ME') === -1
}

function initAuthStatus() {
    const el = document.getElementById('auth_status')
    if (!el) { return }
    if (!authIsConfigured()) {
        // Login hasn't been set up for this deployment yet - stay silent rather than showing a
        // broken/non-functional "Sign in" link.
        el.innerHTML = ''
        return
    }
    const session = authReadSession()
    if (session && authIsLoggedIn()) {
        el.innerHTML = '<span class="text-secondary">Signed in as ' + escapeHtml(session.username) + '</span> ' +
            '<a href="#" id="authSignOutLink">Sign out</a>'
        document.getElementById('authSignOutLink').addEventListener('click', function(e) {
            e.preventDefault()
            authLogout('/')
        })
    } else {
        el.innerHTML = '<a href="/login.html">Sign in</a>'
    }
}

// --- V2 gallery grid: tile size slider (persisted in the browser) ---
const gallerySizeStorageKey = 'pfb_gallery_tile_size'
const gallerySizeDefault = 140

function applyTileSize(px) {
    const listingEl = document.getElementById('listing')
    if (!listingEl) { return }
    listingEl.style.setProperty('--tile-size', px + 'px')
}

function initGallerySizeSlider() {
    const slider = document.getElementById('tileSizeSlider')
    if (!slider) { return }
    let savedSize = gallerySizeDefault
    try {
        const stored = window.localStorage.getItem(gallerySizeStorageKey)
        if (stored !== null) {
            const parsed = parseInt(stored, 10)
            if (!Number.isNaN(parsed)) { savedSize = parsed }
        }
    } catch (e) {
        // localStorage unavailable (e.g. privacy mode) - fall back to the default size.
    }
    slider.value = savedSize
    applyTileSize(savedSize)
    slider.addEventListener('input', function() {
        const px = parseInt(slider.value, 10)
        applyTileSize(px)
        try {
            window.localStorage.setItem(gallerySizeStorageKey, String(px))
        } catch (e) {
            // Ignore - persistence is a nice-to-have, not required for the slider to work.
        }
    })
}

// --- Video tile thumbnails: extract an actual first frame client-side, lazily ---
// Only requests the video (via a small metadata + seek fetch) once its tile actually scrolls
// into view, rather than fetching every video's data as soon as a folder full of clips renders.
let videoThumbObserver = null

function captureVideoFrame(el) {
    const src = el.getAttribute('data-video-src')
    if (!src || el.dataset.captured === '1') { return }
    el.dataset.captured = '1'
    const videoEl = document.createElement('video')
    videoEl.muted = true
    videoEl.preload = 'metadata'
    videoEl.playsInline = true

    function cleanup() {
        videoEl.removeEventListener('loadedmetadata', onLoadedMetadata)
        videoEl.removeEventListener('seeked', onSeeked)
        videoEl.removeEventListener('error', onError)
        videoEl.src = ''
    }

    function onSeeked() {
        try {
            const canvas = document.createElement('canvas')
            canvas.width = videoEl.videoWidth || 160
            canvas.height = videoEl.videoHeight || 160
            const ctx = canvas.getContext('2d')
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
            el.style.backgroundImage = 'url(' + dataUrl + ')'
            el.classList.add('video_frame_captured')
        } catch (e) {
            // Canvas is likely CORS-tainted (bucket/CloudFront isn't sending
            // Access-Control-Allow-Origin for video GETs) - silently keep the play-icon fallback.
        }
        cleanup()
    }

    function onLoadedMetadata() {
        try {
            // A small nonzero seek forces the browser to actually decode a frame in every engine
            // (some browsers won't paint a frame at exactly t=0). This only pulls in a little
            // extra data via HTTP range requests, not the whole file.
            videoEl.currentTime = Math.min(0.5, (videoEl.duration || 1) / 4)
        } catch (e) {
            cleanup()
        }
    }

    function onError() {
        cleanup()
    }

    videoEl.addEventListener('loadedmetadata', onLoadedMetadata, { once: true })
    videoEl.addEventListener('seeked', onSeeked, { once: true })
    videoEl.addEventListener('error', onError, { once: true })
    videoEl.src = src
}

function initVideoThumbnailObserver() {
    if (videoThumbObserver) { return }
    if (!('IntersectionObserver' in window)) {
        // No lazy-loading support - fall back to capturing immediately as a no-op-safe shim.
        videoThumbObserver = { observe: function(el) { captureVideoFrame(el) } }
        return
    }
    videoThumbObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (!entry.isIntersecting) { return }
            captureVideoFrame(entry.target)
            videoThumbObserver.unobserve(entry.target)
        })
    }, { rootMargin: '200px 0px' })
}

function observeVideoThumbnails() {
    if (!videoThumbObserver) { return }
    document.querySelectorAll('.video_frame_thumb').forEach(function(el) {
        videoThumbObserver.observe(el)
    })
}

function initMediaGallery() {
    const modalEl = document.getElementById('mediaGalleryModal')
    if (!modalEl) { return }
    mediaGalleryModalInstance = new bootstrap.Modal(modalEl)
    document.getElementById('mediaGalleryPrev').addEventListener('click', function() {
        showMediaAt(currentMediaIndex - 1)
    })
    document.getElementById('mediaGalleryNext').addEventListener('click', function() {
        showMediaAt(currentMediaIndex + 1)
    })
    // Clear the media content on close so a playing video/audio stops immediately.
    modalEl.addEventListener('hidden.bs.modal', function() {
        document.getElementById('mediaGalleryContent').innerHTML = ''
        currentMediaIndex = -1
    })
    document.addEventListener('keydown', function(e) {
        if (!modalEl.classList.contains('show')) { return }
        if (e.key === 'ArrowLeft') {
            showMediaAt(currentMediaIndex - 1)
        } else if (e.key === 'ArrowRight') {
            showMediaAt(currentMediaIndex + 1)
        }
    })
    // Touch swipe support: swipe left -> next, swipe right -> previous.
    let touchStartX = null
    let touchStartY = null
    const galleryBody = document.getElementById('mediaGalleryBody')
    galleryBody.addEventListener('touchstart', function(e) {
        touchStartX = e.changedTouches[0].clientX
        touchStartY = e.changedTouches[0].clientY
    }, { passive: true })
    galleryBody.addEventListener('touchend', function(e) {
        if (touchStartX === null) { return }
        const dx = e.changedTouches[0].clientX - touchStartX
        const dy = e.changedTouches[0].clientY - touchStartY
        touchStartX = null
        touchStartY = null
        // While zoomed in, a single-finger touch is for panning the image, not swipe-navigation.
        if (zoomScale > MIN_ZOOM) { return }
        // Ignore mostly-vertical swipes and small movements (accidental taps/scrolls).
        const minSwipeDistance = 40
        if (Math.abs(dx) < minSwipeDistance || Math.abs(dx) < Math.abs(dy)) { return }
        if (dx < 0) {
            showMediaAt(currentMediaIndex + 1)
        } else {
            showMediaAt(currentMediaIndex - 1)
        }
    }, { passive: true })
    initGalleryZoom()
    initThumbnailHoverPreview()
}

// --- Lightbox zoom (click to toggle, scroll wheel, pinch, drag-to-pan) ---
const MIN_ZOOM = 1
const MAX_ZOOM = 4
let zoomScale = 1
let zoomTranslateX = 0
let zoomTranslateY = 0
let isPanning = false
let panStartX = 0
let panStartY = 0
let panOriginX = 0
let panOriginY = 0
let pinchStartDistance = null
let pinchStartScale = 1

function resetZoomState() {
    zoomScale = 1
    zoomTranslateX = 0
    zoomTranslateY = 0
    isPanning = false
    pinchStartDistance = null
    applyZoomTransform()
}

function applyZoomTransform() {
    const img = document.querySelector('#mediaGalleryContent img.gallery_media')
    if (!img) { return }
    img.style.transform = 'translate(' + zoomTranslateX + 'px, ' + zoomTranslateY + 'px) scale(' + zoomScale + ')'
    img.style.cursor = zoomScale > MIN_ZOOM ? (isPanning ? 'grabbing' : 'zoom-out') : 'zoom-in'
}

function clampZoomTranslate() {
    // Loose clamp so a zoomed image can be panned around without dragging entirely off-screen.
    const maxOffset = 300 * zoomScale
    zoomTranslateX = Math.max(-maxOffset, Math.min(maxOffset, zoomTranslateX))
    zoomTranslateY = Math.max(-maxOffset, Math.min(maxOffset, zoomTranslateY))
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
}

function isGalleryImage(el) {
    return !!el && el.tagName === 'IMG' && el.classList.contains('gallery_media')
}

function initGalleryZoom() {
    const content = document.getElementById('mediaGalleryContent')

    content.addEventListener('click', function(e) {
        if (!isGalleryImage(e.target) || isPanning) { return }
        if (zoomScale > MIN_ZOOM) {
            resetZoomState()
        } else {
            zoomScale = 2.2
            zoomTranslateX = 0
            zoomTranslateY = 0
            applyZoomTransform()
        }
    })

    content.addEventListener('wheel', function(e) {
        if (!isGalleryImage(e.target)) { return }
        e.preventDefault()
        const delta = e.deltaY < 0 ? 0.2 : -0.2
        zoomScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomScale + delta))
        if (zoomScale === MIN_ZOOM) { zoomTranslateX = 0; zoomTranslateY = 0 }
        clampZoomTranslate()
        applyZoomTransform()
    }, { passive: false })

    content.addEventListener('mousedown', function(e) {
        if (!isGalleryImage(e.target) || zoomScale <= MIN_ZOOM) { return }
        isPanning = true
        panStartX = e.clientX
        panStartY = e.clientY
        panOriginX = zoomTranslateX
        panOriginY = zoomTranslateY
        applyZoomTransform()
        e.preventDefault()
    })

    document.addEventListener('mousemove', function(e) {
        if (!isPanning) { return }
        zoomTranslateX = panOriginX + (e.clientX - panStartX)
        zoomTranslateY = panOriginY + (e.clientY - panStartY)
        clampZoomTranslate()
        applyZoomTransform()
    })

    document.addEventListener('mouseup', function() {
        if (!isPanning) { return }
        isPanning = false
        applyZoomTransform()
    })

    // Touch: two-finger pinch to zoom, single-finger drag to pan once zoomed in.
    content.addEventListener('touchstart', function(e) {
        if (!isGalleryImage(e.target)) { return }
        if (e.touches.length === 2) {
            pinchStartDistance = getTouchDistance(e.touches)
            pinchStartScale = zoomScale
        } else if (e.touches.length === 1 && zoomScale > MIN_ZOOM) {
            isPanning = true
            panStartX = e.touches[0].clientX
            panStartY = e.touches[0].clientY
            panOriginX = zoomTranslateX
            panOriginY = zoomTranslateY
        }
    }, { passive: true })

    content.addEventListener('touchmove', function(e) {
        if (!isGalleryImage(e.target)) { return }
        if (e.touches.length === 2 && pinchStartDistance) {
            const newDistance = getTouchDistance(e.touches)
            zoomScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartScale * (newDistance / pinchStartDistance)))
            if (zoomScale === MIN_ZOOM) { zoomTranslateX = 0; zoomTranslateY = 0 }
            clampZoomTranslate()
            applyZoomTransform()
        } else if (e.touches.length === 1 && isPanning) {
            zoomTranslateX = panOriginX + (e.touches[0].clientX - panStartX)
            zoomTranslateY = panOriginY + (e.touches[0].clientY - panStartY)
            clampZoomTranslate()
            applyZoomTransform()
        }
    }, { passive: true })

    content.addEventListener('touchend', function(e) {
        if (e.touches.length < 2) { pinchStartDistance = null }
        if (e.touches.length === 0) { isPanning = false }
    })
}

// --- Thumbnail hover-zoom preview in the listing (desktop/mouse only) ---
const supportsHoverPreview = window.matchMedia && window.matchMedia('(hover: hover)').matches

function initThumbnailHoverPreview() {
    if (!supportsHoverPreview) { return }
    const previewEl = document.getElementById('thumbHoverPreview')
    const listingEl = document.getElementById('listing')
    if (!previewEl || !listingEl) { return }

    function positionPreview(x, y) {
        const offset = 16
        const rect = previewEl.getBoundingClientRect()
        let left = x + offset
        let top = y + offset
        if (left + rect.width > window.innerWidth) { left = x - rect.width - offset }
        if (top + rect.height > window.innerHeight) { top = y - rect.height - offset }
        previewEl.style.left = Math.max(4, left) + 'px'
        previewEl.style.top = Math.max(4, top) + 'px'
    }

    listingEl.addEventListener('mouseover', function(e) {
        const link = e.target.closest('.thumb_link')
        if (!link) { return }
        // Video thumbnails are just a generic play icon (no frame available), so an enlarged
        // preview adds nothing and only collides visually with the native title tooltip.
        if (link.classList.contains('video_thumb')) { return }
        previewEl.innerHTML = '<img src="' + link.getAttribute('href') + '" alt="">'
        previewEl.style.display = 'block'
        positionPreview(e.clientX, e.clientY)
    })

    listingEl.addEventListener('mousemove', function(e) {
        if (previewEl.style.display !== 'block') { return }
        if (!e.target.closest('.thumb_link')) { return }
        positionPreview(e.clientX, e.clientY)
    })

    listingEl.addEventListener('mouseout', function(e) {
        const link = e.target.closest('.thumb_link')
        if (!link) { return }
        if (link.contains(e.relatedTarget)) { return }
        previewEl.style.display = 'none'
        previewEl.innerHTML = ''
    })
}

function openMediaGallery(encodedUrl) {
    const url = atob(encodedUrl)
    const idx = currentMediaList.findIndex(function(m) { return m.key === url })
    if (idx === -1) { return false }
    showMediaAt(idx)
    return false
}

function showMediaAt(idx) {
    // Boundaries are simply disabled/no-op here rather than wrapping, since the listing is
    // paginated server-side (see currentMediaList comment above) and only the items on the
    // currently loaded page are known to the gallery.
    if (idx < 0 || idx >= currentMediaList.length) { return }
    currentMediaIndex = idx
    const item = currentMediaList[idx]
    let mediaHtml = ''
    if (item.type === 'image') {
        mediaHtml = '<img class="gallery_media" src="' + item.url + '" alt="' + escapeHtml(item.displayName) + '">'
    } else if (item.type === 'video') {
        mediaHtml = '<video class="gallery_media" src="' + item.url + '" controls autoplay></video>'
    }
    document.getElementById('mediaGalleryContent').innerHTML = mediaHtml
    document.getElementById('mediaGalleryCaption').textContent = item.displayName
    document.getElementById('mediaGalleryPrev').disabled = (idx <= 0)
    document.getElementById('mediaGalleryNext').disabled = (idx >= currentMediaList.length - 1)
    resetZoomState()
    if (mediaGalleryModalInstance) {
        mediaGalleryModalInstance.show()
    }
}

function processUrl() {
    const params = new Proxy(new URLSearchParams(window.location.search), {
        get: (searchParams, prop) => searchParams.get(prop),
    });
    reset(params['p'] ?? '', params['s'] ?? '')
}


function localNav(newPrefix, start_at) {
    reset(atob(newPrefix), atob(start_at))
    return false;
}

var entityMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

function escapeHtml(string) {
  return String(string).replace(/[&<>"'`=\/]/g, function (s) {
    return entityMap[s];
  });
}

function s3FileSize(bytes, accuracy) {
    if (bytes < 2**10) {
        return bytes + ' B'
    } else if (bytes < 2**20) {
        return (bytes / 2**10).toFixed(accuracy) + ' KB'
    } else if (bytes < 2**30) {
        return (bytes / 2**20).toFixed(accuracy) + ' MB'
    } else if (bytes < 2**40) {
        return (bytes / 2**30).toFixed(accuracy) + ' GB'
    } else if (bytes < 2**50) {
        return (bytes / 2**40).toFixed(accuracy) + ' TB'
    } else if (bytes < 2**60) {
        return (bytes / 2**50).toFixed(accuracy) + ' PB'
    } else if (bytes < 2**70) {
        return (bytes / 2**60).toFixed(accuracy) + ' EB'
    } else if (bytes < 2**80) {
        return (bytes / 2**70).toFixed(accuracy) + ' ZB'
    } else {
        return (bytes / 2**80).toFixed(accuracy) + ' YB'
    }
}


window.addEventListener('popstate', event => {
   processUrl();
});
