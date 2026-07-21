FROM python:3.11-slim

WORKDIR /app

# fiona requires GDAL/GEOS/PROJ + gcc to build C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ \
    gdal-bin libgdal-dev \
    libgeos-dev libproj-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Match GDAL Python binding to system library version
RUN pip install --no-cache-dir \
        GDAL==$(gdal-config --version) \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
