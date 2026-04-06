import QrScanner from 'qr-scanner';

const registerMenuGroup = document.getElementById('registerMenuGroup');
const registerMenuToggle = document.getElementById('registerMenuToggle');

if (registerMenuGroup && registerMenuToggle) {
	registerMenuToggle.addEventListener('click', () => {
		const isOpen = registerMenuGroup.classList.toggle('open');
		registerMenuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
	});
}

const scannerZone = document.querySelector('.scanner-zone');
const cameraFeed = document.getElementById('cameraFeed');
const scanButton = document.getElementById('scanButton');
const scanButtonText = document.getElementById('scanButtonText');
const cameraStatus = document.getElementById('cameraStatus');
const scanResult = document.getElementById('scanResult');
const scanPopup = document.getElementById('scanPopup');
const scanPopupText = document.getElementById('scanPopupText');
const scanPopupClose = document.getElementById('scanPopupClose');
const scanPopupOpenLink = document.getElementById('scanPopupOpenLink');
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

let activeStream = null;
let scanLoopTimeout = null;
let isScannerRunning = false;
let isProcessingScan = false;
let lastProcessedQr = '';
let resumeScanTimeout = null;
let detectedUrl = '';

const waitForVideoReady = (videoElement, timeoutMs = 3000) =>
	new Promise((resolve, reject) => {
		if (!videoElement) {
			reject(new Error('Camera video element is missing.'));
			return;
		}

		if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			resolve();
			return;
		}

		const timeoutId = setTimeout(() => {
			cleanup();
			reject(new Error('Camera stream was created but no video frame is available.'));
		}, timeoutMs);

		const onReady = () => {
			cleanup();
			resolve();
		};

		const cleanup = () => {
			clearTimeout(timeoutId);
			videoElement.removeEventListener('loadeddata', onReady);
			videoElement.removeEventListener('playing', onReady);
		};

		videoElement.addEventListener('loadeddata', onReady);
		videoElement.addEventListener('playing', onReady);
	});

const setScannerState = (isOn, message) => {
	scannerZone?.classList.toggle('camera-on', isOn);
	scanButtonText.textContent = isOn ? 'Scan Exit QR' : 'Retry Camera';
	cameraStatus.textContent = message;
	scanButton.disabled = false;
};

const setResult = (message, type = '') => {
	scanResult.textContent = message;
	scanResult.className = 'scan-result';
	if (type) {
		scanResult.classList.add(type);
	}
};

const openPopup = (message) => {
	if (!scanPopup || !scanPopupText) {
		return;
	}

	scanPopupText.textContent = message;
	scanPopup.classList.add('visible');
};

const normalizeHttpUrl = (value) => {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return null;
	}

	const withProtocol = /^(https?:)?\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;

	try {
		const parsed = new URL(withProtocol);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return parsed.toString();
		}
	} catch (error) {
		return null;
	}

	return null;
};

const updateOpenLinkButton = (value) => {
	if (!scanPopupOpenLink) {
		return;
	}

	const normalized = normalizeHttpUrl(value);
	detectedUrl = normalized || '';

	if (detectedUrl) {
		scanPopupOpenLink.classList.remove('hidden');
		return;
	}

	scanPopupOpenLink.classList.add('hidden');
};

const closePopup = () => {
	scanPopup?.classList.remove('visible');
};

const clearResumeTimeout = () => {
	if (resumeScanTimeout) {
		clearTimeout(resumeScanTimeout);
		resumeScanTimeout = null;
	}
};

const clearScanLoop = () => {
	if (scanLoopTimeout) {
		clearTimeout(scanLoopTimeout);
		scanLoopTimeout = null;
	}
};

const processQrData = async (qrData) => {
	if (!qrData || isProcessingScan || qrData === lastProcessedQr) {
		return;
	}

	isProcessingScan = true;
	lastProcessedQr = qrData;
	setResult('QR detected. Processing exit...', '');
	updateOpenLinkButton(qrData);
	openPopup('Scanned QR: ' + qrData + '\nProcessing exit...');

	try {
		const response = await fetch('/guard/exit/scan', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				'X-CSRF-TOKEN': csrfToken
			},
			body: JSON.stringify({ qr_data: qrData })
		});

		const payload = await response.json();
		if (!response.ok || payload.status !== 'ok') {
			throw new Error(payload.message || 'Unable to process scanned QR.');
		}

		const successMessage = payload.message + ' (' + payload.qr_data + ')';
		setResult(successMessage, 'success');
		updateOpenLinkButton(payload.qr_data || qrData);
		openPopup(successMessage);
		cameraStatus.textContent = 'Scan completed. Ready for next QR.';
	} catch (error) {
		lastProcessedQr = '';
		const errorMessage = error?.message || 'Scan failed. Please try again.';
		setResult(errorMessage, 'error');
		updateOpenLinkButton(qrData);
		openPopup(errorMessage);
	}

	isProcessingScan = false;
	clearResumeTimeout();

	resumeScanTimeout = setTimeout(() => {
		lastProcessedQr = '';
		setResult('');
	}, 3000);
};

const startCamera = async () => {
	if (!cameraFeed) {
		return;
	}

	if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
		setScannerState(false, 'Camera access is not supported in this browser.');
		return;
	}

	try {
		stopCamera();

		activeStream = await navigator.mediaDevices.getUserMedia({
			video: {
				facingMode: { ideal: 'environment' },
				width: { ideal: 1280 },
				height: { ideal: 720 }
			},
			audio: false
		});

		cameraFeed.srcObject = activeStream;
		await waitForVideoReady(cameraFeed);
		await cameraFeed.play();
		cameraFeed.style.display = 'block';
		cameraFeed.style.visibility = 'visible';
		cameraFeed.style.opacity = '1';
		isScannerRunning = true;
		setScannerState(true, 'Scanner is ready. Position the QR inside the frame.');
		setResult('Waiting for QR code...');

		const scanFrame = async () => {
			if (!isScannerRunning || isProcessingScan || !cameraFeed.videoWidth || !cameraFeed.videoHeight) {
				scanLoopTimeout = setTimeout(scanFrame, 250);
				return;
			}

			try {
				const detected = await QrScanner.scanImage(cameraFeed, {
					returnDetailedScanResult: true
				});
				if (detected?.data) {
					processQrData(detected.data);
				}
			} catch (error) {
				// No QR in current frame.
			}

			scanLoopTimeout = setTimeout(scanFrame, 250);
		};

		scanFrame();
	} catch (error) {
		isScannerRunning = false;
		setScannerState(false, 'Camera permission denied or unavailable. Click Retry Camera after allowing access.');
		setResult((error && error.message) || 'Camera is required for QR scanning.', 'error');
	}
};

const stopCamera = () => {
	clearScanLoop();
	clearResumeTimeout();
	if (activeStream) {
		activeStream.getTracks().forEach((track) => track.stop());
		activeStream = null;
	}
	isScannerRunning = false;
	if (cameraFeed) {
		cameraFeed.srcObject = null;
		cameraFeed.style.display = 'none';
		cameraFeed.style.visibility = 'hidden';
		cameraFeed.style.opacity = '0';
	}
};

scanButton?.addEventListener('click', async () => {
	if (!isScannerRunning) {
		await startCamera();
		return;
	}

	cameraStatus.textContent = 'Scanner is live. Align QR code inside the frame.';
	setResult('Waiting for QR code...');
	lastProcessedQr = '';
});

scanPopup?.addEventListener('click', (event) => {
	if (event.target === scanPopup) {
		closePopup();
	}
});

scanPopupClose?.addEventListener('click', () => {
	closePopup();
});

scanPopupOpenLink?.addEventListener('click', () => {
	if (!detectedUrl) {
		return;
	}

	window.location.href = detectedUrl;
});

window.addEventListener('beforeunload', () => {
	stopCamera();
});

startCamera();
